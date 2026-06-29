import { execSync } from "node:child_process";
import { ScannerError } from "../utils/errors";
import type { Advisory, AdvisoryBundle } from "../types/advisory";

interface NpmAuditVulnerability {
  readonly name: string;
  readonly severity: string;
  readonly range: string;
  readonly title?: string;
  readonly via?: Array<string | { title?: string; cve?: string }>;
  readonly fixAvailable?: boolean | { name: string; version: string };
}

interface NpmAuditResponse {
  readonly vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

const mapNpmSeverity = (severity: string): Advisory["severity"] => {
  const s = severity.toLowerCase();
  if (s === "critical") return "CRITICAL";
  if (s === "high") return "HIGH";
  if (s === "moderate") return "MEDIUM";
  if (s === "low") return "LOW";
  return "NONE";
};

const extractCve = (via: Array<string | { title?: string; cve?: string }> | undefined): string | null => {
  if (!via) return null;
  for (const entry of via) {
    if (typeof entry === "string" && entry.startsWith("CVE-")) {
      return entry;
    }
    if (typeof entry === "object") {
      if (entry.cve) return entry.cve;
      if (entry.title?.startsWith("CVE-")) return entry.title;
    }
  }
  return null;
};

export const runNpmAudit = (cwd: string): AdvisoryBundle => {
  try {
    const raw = execSync("npm audit --json", {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const parsed: NpmAuditResponse = JSON.parse(raw);
    const advisories: Advisory[] = [];

    const vulns = parsed.vulnerabilities;
    if (vulns) {
      for (const vuln of Object.values(vulns)) {
        if (!vuln.name) continue;

        advisories.push({
          id: `npm-${vuln.name}-${vuln.range}`,
          cveId: extractCve(vuln.via),
          source: "npm-audit",
          packageName: vuln.name,
          affectedVersion: vuln.range,
          fixVersion: typeof vuln.fixAvailable === "object" ? vuln.fixAvailable.version : null,
          severity: mapNpmSeverity(vuln.severity),
          title: vuln.title ?? `Vulnerability in ${vuln.name}`,
          description: vuln.title ?? `Security vulnerability found in ${vuln.name} (${vuln.severity})`,
          vulnerableFunctions: [],
          references: [],
          publishedAt: null,
        });
      }
    }

    return {
      advisories,
      source: "npm-audit",
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ScannerError("AUDIT_PARSE_ERROR", "Failed to parse npm audit output", {
        originalError: err.message,
      });
    }
    throw new ScannerError("AUDIT_FAILED", "npm audit command failed", {
      originalError: err instanceof Error ? err.message : String(err),
    });
  }
};
