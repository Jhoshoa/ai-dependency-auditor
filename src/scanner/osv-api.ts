import { fetchWithRetry } from "../utils/network";
import { NetworkError } from "../utils/errors";
import type { Advisory, AdvisoryBundle } from "../types/advisory";

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

const parseOsvResponse = (response: OsvQueryResponse, packageName: string): Advisory[] => {
  const vulns = response.vulns;
  if (!vulns) return [];

  return vulns
    .filter((vuln) => vuln.id)
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

export const queryOsv = async (
  deps: ReadonlyArray<{ name: string; version: string }>,
): Promise<AdvisoryBundle> => {
  if (deps.length === 0) {
    return {
      advisories: [],
      source: "osv-dev",
      fetchedAt: new Date().toISOString(),
    };
  }

  const allAdvisories: Advisory[] = [];

  for (const dep of deps) {
    try {
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
      const advisories = parseOsvResponse({ vulns }, dep.name);
      allAdvisories.push(...advisories);
    } catch (err) {
      if (err instanceof NetworkError && err.statusCode === 429) {
        throw err;
      }
    }
  }

  return {
    advisories: allAdvisories,
    source: "osv-dev",
    fetchedAt: new Date().toISOString(),
  };
};
