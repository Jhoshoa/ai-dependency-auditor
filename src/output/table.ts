import pc from "picocolors";
import type { AuditReport } from "../agent/orchestrator";

export const formatTable = (auditReport: AuditReport): string => {
  const { report, steps, totalDurationMs } = auditReport;
  const lines: string[] = [];

  lines.push(`\n${pc.bold("AI Dependency Auditor")}`);
  lines.push(`${pc.dim("Project:")} ${report.metadata.projectPath}`);
  lines.push(`${pc.dim("Dependencies:")} ${report.summary.totalDependencies}`);
  lines.push(`${pc.dim("Sources:")} ${[...report.metadata.sourcesUsed].join(", ") || "none"}`);
  lines.push(`${pc.dim("Mode:")} ${report.metadata.mode}`);
  if (steps.length > 0) {
    const stepSummary = steps.map(s => `${s.name}=${s.status}`).join(", ");
    lines.push(`${pc.dim("Steps:")} ${stepSummary}`);
  }
  lines.push(`${pc.dim("Duration:")} ${totalDurationMs}ms\n`);

  if (report.summary.totalAdvisories === 0) {
    lines.push(`${pc.green("✓ No vulnerabilities found.")}\n`);
    return lines.join("\n");
  }

  const critical = report.summary.criticalCount;
  const high = report.summary.highCount;
  const medium = report.summary.mediumCount;
  const low = report.summary.lowCount;
  const fps = report.summary.falsePositives;

  lines.push(
    `${pc.red(`CRITICAL: ${critical}`)} | ${pc.red(`HIGH: ${high}`)} | ${pc.yellow(`MEDIUM: ${medium}`)} | ${pc.dim(`LOW: ${low}`)}${fps > 0 ? ` | ${pc.green(`FP: ${fps}`)}` : ""}\n`,
  );

  for (const result of report.results) {
    const severityColor = result.risk === "CRITICAL" || result.risk === "HIGH"
      ? pc.red
      : result.risk === "MEDIUM"
        ? pc.yellow
        : pc.dim;

    const usageIcon = result.usage === "USED" ? pc.red("●") : result.usage === "NOT_USED" ? pc.green("○") : pc.dim("?");

    lines.push(
      `${severityColor(result.risk.padEnd(8))} ${pc.bold(result.dependency.name)}@${result.dependency.version}`,
    );
    lines.push(`  ${pc.dim(result.advisory.title)}`);
    if (result.advisory.cveId) lines.push(`  ${pc.dim(`CVE: ${result.advisory.cveId}`)}`);
    if (result.advisory.fixVersion) lines.push(`  ${pc.green(`Fix: upgrade to ${result.advisory.fixVersion}`)}`);
    lines.push(`  ${usageIcon} ${pc.dim(`Usage: ${result.usage} (${Math.round(result.confidence * 100)}% confidence)`)}`);
    if (result.usageEvidence.length > 0) {
      for (const ev of result.usageEvidence.slice(0, 3)) {
        lines.push(`    ${pc.dim(ev)}`);
      }
      if (result.usageEvidence.length > 3) {
        lines.push(`    ${pc.dim(`... and ${result.usageEvidence.length - 3} more`)}`);
      }
    }
    lines.push("");
  }

  if (report.summary.falsePositives > 0) {
    lines.push(`${pc.green(`✓ ${report.summary.falsePositives} false positive(s) identified by LLM analysis.`)}\n`);
  }

  return lines.join("\n");
};
