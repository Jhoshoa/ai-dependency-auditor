import pc from "picocolors";
import type { AuditReport } from "../agent/orchestrator";

const severityColor = (severity: string) =>
  severity === "CRITICAL" || severity === "HIGH"
    ? pc.red
    : severity === "MEDIUM"
      ? pc.yellow
      : pc.dim;

const formatQuickRow = (r: AuditReport["report"]["results"][number]): string[] => {
  const color = severityColor(r.advisory.severity);
  const lines: string[] = [];
  lines.push(`${color(r.advisory.severity.padEnd(8))} ${pc.bold(r.dependency.name)}@${r.dependency.version}`);
  if (r.advisory.cveId) {
    lines.push(`  ${pc.dim(`${r.advisory.cveId}: ${r.advisory.title}`)}`);
  } else {
    lines.push(`  ${pc.dim(r.advisory.title)}`);
  }
  if (r.advisory.fixVersion) {
    lines.push(`  ${pc.green(`Fix: upgrade to ${r.advisory.fixVersion}`)}`);
  }
  return lines;
};

const formatFullRow = (r: AuditReport["report"]["results"][number]): string[] => {
  const lines: string[] = [];
  const pkgLabel = `${pc.bold(r.dependency.name)}@${r.dependency.version}`;

  if (r.usage === "USED") {
    const color = severityColor(r.advisory.severity);
    lines.push(`  ${pc.red("● USED")} ${color(r.advisory.severity.padEnd(8))} ${pkgLabel}`);
  } else if (r.usage === "NOT_USED") {
    lines.push(`  ${pc.green("○ FP")}   ${pkgLabel} ${pc.dim(`(severity: ${r.advisory.severity}, but not used)`)}`);
  } else {
    const color = severityColor(r.advisory.severity);
    lines.push(`  ${pc.dim("?")}      ${color(r.advisory.severity.padEnd(8))} ${pkgLabel}`);
  }

  if (r.advisory.cveId) {
    lines.push(`           ${pc.dim(`${r.advisory.cveId}: ${r.advisory.title}`)}`);
  } else {
    lines.push(`           ${pc.dim(r.advisory.title)}`);
  }
  if (r.advisory.fixVersion) {
    lines.push(`           ${pc.green(`Fix: upgrade to ${r.advisory.fixVersion}`)}`);
  }

  if (r.usage === "USED" && r.usageEvidence.length > 0) {
    for (const ev of r.usageEvidence.slice(0, 3)) {
      lines.push(`           ${pc.cyan("→")} ${pc.dim(ev)}`);
    }
    if (r.usageEvidence.length > 3) {
      lines.push(`           ${pc.dim(`... and ${r.usageEvidence.length - 3} more evidence lines`)}`);
    }
    lines.push(`           ${pc.dim(`Confidence: ${Math.round(r.confidence * 100)}%`)}`);
  } else if (r.usage === "NOT_USED") {
    lines.push(`           ${pc.dim("→ Not imported or called in project source")}`);
    lines.push(`           ${pc.dim(`Confidence: ${Math.round(r.confidence * 100)}%`)}`);
  } else if (r.usage === "CANT_DETERMINE") {
    if (r.usageEvidence.length > 0) {
      for (const ev of r.usageEvidence.slice(0, 2)) {
        lines.push(`           ${pc.yellow("→")} ${pc.dim(ev)}`);
      }
    } else {
      lines.push(`           ${pc.dim("→ Could not determine usage (no source references found)")}`);
    }
  }

  return lines;
};

export const formatTable = (auditReport: AuditReport): string => {
  const { report, steps, totalDurationMs } = auditReport;
  const lines: string[] = [];

  const isQuick = report.metadata.mode === "quick";

  lines.push(`\n${pc.bold("AI Dependency Auditor")}`);
  lines.push(`${pc.dim("Project:")} ${report.metadata.projectPath}`);
  lines.push(`${pc.dim("Dependencies:")} ${report.summary.totalDependencies}`);
  lines.push(`${pc.dim("Sources:")} ${[...report.metadata.sourcesUsed].join(", ") || "none"}`);
  if (isQuick) {
    lines.push(`${pc.dim("Mode:")} ${pc.yellow("quick (no LLM)")} — raw advisory list`);
  } else {
    lines.push(`${pc.dim("Mode:")} full — classified by ${report.metadata.llmProvider}/${report.metadata.llmModel}`);
  }
  lines.push(`${pc.dim("Duration:")} ${totalDurationMs}ms\n`);

  if (report.summary.totalAdvisories === 0) {
    lines.push(`${pc.green("✓ No vulnerabilities found.")}\n`);
    return lines.join("\n");
  }

  if (isQuick) {
    // Quick mode: simple advisory list per dep-audit_completo.md V1 spec
    lines.push(pc.dim("No LLM configured — showing raw advisory list"));
    lines.push(pc.dim("──────────────────────────────────────────────"));
    for (const result of report.results) {
      for (const l of formatQuickRow(result)) lines.push(l);
      lines.push("");
    }
    const total = report.summary.totalAdvisories;
    lines.push(`${pc.dim(`Summary: ${total} advisory(ies) found.`)}`);
    lines.push(`${pc.dim("Tip: set up an LLM provider to classify which are real vs false positives.")}\n`);
    return lines.join("\n");
  }

  // Full mode: classified report with usage analysis per V2 spec
  const used = report.results.filter(r => r.usage === "USED");
  const fps = report.results.filter(r => r.usage === "NOT_USED");
  const unknown = report.results.filter(r => r.usage === "CANT_DETERMINE");

  lines.push(pc.dim("LLM source analysis — classified results"));
  lines.push(pc.dim("───────────────────────────────────────────\n"));

  for (const result of report.results) {
    for (const l of formatFullRow(result)) lines.push(l);
    lines.push("");
  }

  // Severity breakdown
  const severityCounts: Record<string, number> = {};
  for (const r of report.results) {
    const sev = r.advisory.severity;
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }

  const sevParts: string[] = [];
  for (const s of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"] as const) {
    const c = severityCounts[s] ?? 0;
    if (c > 0 || s === "NONE") {
      const color = s === "CRITICAL" || s === "HIGH" ? pc.red : s === "MEDIUM" ? pc.yellow : pc.dim;
      sevParts.push(`${color(`${s}: ${c}`)}`);
    }
  }

  lines.push(pc.dim("Severity Breakdown (from advisory sources):"));
  lines.push(`  ${sevParts.join(" | ")}\n`);

  // Count actionable: USED with real severity (not NONE)
  const realHigh = used.filter(r => r.advisory.severity === "HIGH" || r.advisory.severity === "CRITICAL");
  const realMed = used.filter(r => r.advisory.severity === "MEDIUM");
  const usedInfo = used.filter(r => r.advisory.severity === "NONE" || r.advisory.severity === "LOW");

  // Unknown items with real severity that need attention
  const unknownHigh = unknown.filter(r => r.advisory.severity === "HIGH" || r.advisory.severity === "CRITICAL");

  // Group CANT_DETERMINE items by package for cleaner display
  const unknownByPkg = new Map<string, { count: number; severity: string }>();
  for (const r of unknown) {
    const key = `${r.dependency.name}@${r.dependency.version}`;
    const existing = unknownByPkg.get(key);
    if (existing) {
      existing.count++;
    } else {
      unknownByPkg.set(key, { count: 1, severity: r.advisory.severity });
    }
  }

  // Verdict
  const actionItems: string[] = [];

  if (realHigh.length > 0) {
    for (const r of realHigh) {
      actionItems.push(`${pc.red(`${r.advisory.severity} ${r.dependency.name}@${r.dependency.version}`)} — vulnerable function used in source`);
    }
  }

  if (realMed.length > 0) {
    for (const r of realMed) {
      actionItems.push(`${pc.yellow(`${r.advisory.severity} ${r.dependency.name}@${r.dependency.version}`)} — vulnerable function used in source`);
    }
  }

  if (unknownHigh.length > 0) {
    for (const r of unknownHigh) {
      actionItems.push(`${pc.red(`? ${r.advisory.severity} ${r.dependency.name}@${r.dependency.version}`)} — could not verify usage, review manually`);
    }
  }

  if (actionItems.length > 0) {
    lines.push(pc.bold("Action Required:"));
    for (const item of actionItems) {
      lines.push(`  ${item}`);
    }
    lines.push("");
  }

  const infoCount = usedInfo.length;
  const unknownCount = unknown.length - unknownHigh.length;

  if (infoCount > 0) {
    lines.push(pc.dim(`${infoCount} advisory(ies) are informational (package used but severity NONE/LOW).`));
  }
  if (fps.length > 0) {
    lines.push(pc.green(`${fps.length} false positive(s) eliminated by AI analysis (not used in source).`));
  }
  if (unknownCount > 0) {
    if (unknownByPkg.size <= 5) {
      lines.push(pc.dim(`${unknownCount} advisory(ies) could not be classified: ${[...unknownByPkg.entries()].map(([pkg, info]) => `${pkg} (${info.count})`).join(", ")}.`));
    } else {
      const totalUnknown = unknownCount;
      lines.push(pc.dim(`${totalUnknown} advisory(ies) could not be classified across ${unknownByPkg.size} packages.`));
    }
  }
  lines.push("");

  return lines.join("\n");
};
