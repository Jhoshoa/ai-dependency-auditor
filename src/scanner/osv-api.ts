import { fetchWithRetry } from "../utils/network";
import { NetworkError } from "../utils/errors";
import type { Advisory, AdvisoryBundle } from "../types/advisory";
import type { DependencyCache } from "../cache";

interface OsvVulnerability {
  readonly id: string;
  readonly summary?: string;
  readonly details?: string;
  readonly aliases?: string[];
  readonly modified?: string;
  readonly published?: string;
  readonly severity?: Array<{
    readonly type: string;
    readonly score: string;
  }>;
  readonly affected?: Array<{
    readonly package?: { readonly name: string; readonly ecosystem: string };
    readonly ranges?: Array<{
      readonly type: string;
      readonly events?: Array<{ readonly introduced?: string; readonly fixed?: string }>;
    }>;
    readonly database_specific?: {
      readonly severity?: string;
      readonly cwe_ids?: string[];
    };
  }>;
  readonly references?: Array<{ readonly type: string; readonly url: string }>;
}

interface OsvQueryResponse {
  readonly vulns?: readonly OsvVulnerability[];
}

interface OsvBatchResponse {
  readonly results?: Array<{
    readonly vulns?: readonly OsvVulnerability[];
  }>;
}

interface OsvOptions {
  readonly offline?: boolean;
  readonly cache?: DependencyCache;
}

const OSV_API = "https://api.osv.dev/v1/querybatch";

const mapOsvSeverity = (vuln: OsvVulnerability): Advisory["severity"] => {
  const severityEntry = vuln.severity?.[0];
  if (severityEntry) {
    const score = Number.parseFloat(severityEntry.score);
    if (score >= 9.0) return "CRITICAL";
    if (score >= 7.0) return "HIGH";
    if (score >= 4.0) return "MEDIUM";
    if (score > 0) return "LOW";
  }

  const dbSeverity = vuln.affected?.[0]?.database_specific?.severity;
  if (dbSeverity) {
    const s = dbSeverity.toLowerCase();
    if (s === "critical") return "CRITICAL";
    if (s === "high") return "HIGH";
    if (s === "moderate") return "MEDIUM";
    if (s === "low") return "LOW";
  }

  return "NONE";
};

const PRIVATE_PACKAGE_PATTERN = /^@.+\/.+/;

const isPrivatePackage = (name: string): boolean =>
  PRIVATE_PACKAGE_PATTERN.test(name) &&
  !name.startsWith("@angular/") &&
  !name.startsWith("@types/") &&
  !name.startsWith("@babel/") &&
  !name.startsWith("@nestjs/") &&
  !name.startsWith("@vue/") &&
  !name.startsWith("@testing-library/");

const isWithdrawn = (vuln: OsvVulnerability): boolean => {
  if (!vuln.affected) return false;
  for (const affected of vuln.affected) {
    if (affected.ranges) {
      for (const range of affected.ranges) {
        if (range.type === "ECOSYSTEM" && range.events) {
          for (const event of range.events) {
            if ("fixed" in event && event.fixed?.startsWith("0")) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
};

const parseOsvResponse = (response: OsvQueryResponse, packageName: string, includeWithdrawn = false): Advisory[] => {
  const vulns = response.vulns;
  if (!vulns) return [];

  return vulns
    .filter((vuln) => vuln.id)
    .filter((vuln) => includeWithdrawn || !isWithdrawn(vuln))
    .map((vuln) => {
      const affected = vuln.affected?.find(
        (a) => a.package?.name === packageName,
      );

      const fixEvent = affected?.ranges
        ?.find((r) => r.type === "SEMVER")
        ?.events?.find((e: { readonly fixed?: string }) => e.fixed);

      const cveId = vuln.aliases?.find((a) => a.startsWith("CVE-")) ?? null;

      return {
        id: vuln.id,
        cveId,
        source: "osv-dev" as const,
        packageName,
        affectedVersion: "unknown",
        fixVersion: fixEvent?.fixed ?? null,
        severity: mapOsvSeverity(vuln),
        title: vuln.summary ?? `OSV advisory: ${vuln.id}`,
        description: vuln.details ?? vuln.summary ?? "No details available",
        vulnerableFunctions: [] as readonly string[],
        references: vuln.references?.map((r) => r.url) ?? [],
        publishedAt: vuln.published ?? null,
      };
    });
};

const fetchOsvForDep = async (
  dep: { name: string; version: string },
): Promise<Advisory[]> => {
  const response = await fetchWithRetry(
    OSV_API,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: [{
          package: { name: dep.name, ecosystem: "npm" },
        }],
      }),
    },
  );

  if (!response.ok) {
    throw new NetworkError(`OSV API error: ${response.status}`, response.status);
  }

  const data = (await response.json()) as OsvBatchResponse;
  const vulns = data.results?.[0]?.vulns ?? [];
  return parseOsvResponse({ vulns }, dep.name);
};

export const queryOsv = async (
  deps: ReadonlyArray<{ name: string; version: string }>,
  options?: OsvOptions,
): Promise<AdvisoryBundle> => {
  if (deps.length === 0) {
    return {
      advisories: [],
      source: "osv-dev",
      fetchedAt: new Date().toISOString(),
    };
  }

  const { offline = false, cache } = options ?? {};
  const allAdvisories: Advisory[] = [];
  const seen = new Set<string>();

  for (const dep of deps) {
    if (isPrivatePackage(dep.name)) {
      allAdvisories.push({
        id: `private-${dep.name}`,
        cveId: null,
        source: "osv-dev",
        packageName: dep.name,
        affectedVersion: dep.version,
        fixVersion: null,
        severity: "NONE",
        title: `Private package: ${dep.name}`,
        description: `This package (${dep.name}) appears to be a private/scoped package not available in the public npm registry. Manual verification is recommended.`,
        vulnerableFunctions: [],
        references: [],
        publishedAt: null,
      });
      continue;
    }

    if (cache) {
      const cached = offline
        ? cache.getStale(dep.name, dep.version)
        : cache.get(dep.name, dep.version);
      if (cached) {
        for (const a of cached) {
          const key = `${a.packageName}-${a.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            allAdvisories.push(a);
          }
        }
        continue;
      }
    }

    if (offline) continue;

    try {
      const advisories = await fetchOsvForDep(dep);
      if (cache) cache.set(dep.name, dep.version, advisories);
      for (const a of advisories) {
        const key = `${a.packageName}-${a.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          allAdvisories.push(a);
        }
      }
    } catch {
      if (cache) {
        const stale = cache.getStale(dep.name, dep.version);
        if (stale) {
          for (const a of stale) {
            const key = `${a.packageName}-${a.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              allAdvisories.push(a);
            }
          }
        }
      }
    }
  }

  return {
    advisories: allAdvisories,
    source: "osv-dev",
    fetchedAt: new Date().toISOString(),
  };
};
