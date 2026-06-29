import type { AuditReport } from "../agent/orchestrator";

export interface JsonOutput {
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
  readonly results: ReadonlyArray<{
    readonly dependency: { readonly name: string; readonly version: string; readonly type: string };
    readonly advisory: { readonly id: string; readonly cveId: string | null; readonly severity: string; readonly title: string; readonly fixVersion: string | null };
    readonly usage: string;
    readonly usageEvidence: readonly string[];
    readonly risk: string;
    readonly confidence: number;
  }>;
  readonly metadata: {
    readonly projectPath: string;
    readonly llmProvider: string;
    readonly llmModel: string;
    readonly scannedAt: string;
    readonly mode: string;
    readonly sourcesUsed: readonly string[];
  };
  readonly steps: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly durationMs?: number;
    readonly error?: string;
  }>;
  readonly totalDurationMs: number;
}

export const formatJson = (auditReport: AuditReport): string => {
  const { report, steps, totalDurationMs } = auditReport;

  const output: JsonOutput = {
    summary: { ...report.summary },
    results: report.results.map(r => ({
      dependency: { ...r.dependency },
      advisory: { ...r.advisory },
      usage: r.usage,
      usageEvidence: [...r.usageEvidence],
      risk: r.risk,
      confidence: r.confidence,
    })),
    metadata: { ...report.metadata, sourcesUsed: [...report.metadata.sourcesUsed] },
    steps: steps.map(s => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      error: s.error,
    })),
    totalDurationMs,
  };

  return JSON.stringify(output, null, 2);
};
