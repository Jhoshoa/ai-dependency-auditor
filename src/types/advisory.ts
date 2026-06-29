export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface Advisory {
  readonly id: string;
  readonly cveId: string | null;
  readonly source: AdvisorySource;
  readonly packageName: string;
  readonly affectedVersion: string;
  readonly fixVersion: string | null;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly vulnerableFunctions: readonly string[];
  readonly references: readonly string[];
  readonly publishedAt: string | null;
}

export type AdvisorySource = "npm-audit" | "osv-dev" | "github-advisory";

export interface AdvisoryBundle {
  readonly advisories: Advisory[];
  readonly source: AdvisorySource;
  readonly fetchedAt: string;
}
