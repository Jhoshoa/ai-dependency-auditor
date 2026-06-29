export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type UsageStatus = "USED" | "NOT_USED" | "CANT_DETERMINE";

export interface AnalysisResult {
  readonly dependency: {
    readonly name: string;
    readonly version: string;
    readonly type: "prod" | "dev" | "optional" | "peer";
  };
  readonly advisory: {
    readonly id: string;
    readonly cveId: string | null;
    readonly severity: Severity;
    readonly title: string;
    readonly fixVersion: string | null;
  };
  readonly usage: UsageStatus;
  readonly usageEvidence: readonly string[];
  readonly risk: RiskLevel;
  readonly confidence: number;
}

export interface Report {
  readonly summary: {
    readonly totalDependencies: number;
    readonly totalAdvisories: number;
    readonly criticalCount: number;
    readonly highCount: number;
    readonly mediumCount: number;
    readonly lowCount: number;
    readonly falsePositives: number;
    readonly scanDurationMs: number;
  };
  readonly results: readonly AnalysisResult[];
  readonly metadata: {
    readonly projectPath: string;
    readonly llmProvider: string;
    readonly llmModel: string;
    readonly scannedAt: string;
    readonly mode: "full" | "quick";
    readonly sourcesUsed: readonly string[];
  };
}

import type { Severity } from "./advisory";
