import type { AuditReport } from "../agent/orchestrator";

export const formatSummary = (auditReport: AuditReport): string => {
  const { report, totalDurationMs } = auditReport;
  const { summary, metadata } = report;

  const total = summary.totalAdvisories;
  const critical = summary.criticalCount;
  const high = summary.highCount;
  const fps = summary.falsePositives;

  let line = `[dep-audit] ${metadata.mode === "full" ? "Full" : "Quick"} audit: ${summary.totalDependencies} deps, ${total} advisories`;

  if (total > 0) {
    line += ` (${critical} critical, ${high} high`;
    if (fps > 0) line += `, ${fps} false positives identified`;
    line += ")";
  }

  line += ` | ${metadata.llmProvider}:${metadata.llmModel} | ${totalDurationMs}ms`;

  return `\n${line}\n`;
};
