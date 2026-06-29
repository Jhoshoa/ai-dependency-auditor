import { describe, it, expect } from "vitest";
import { formatTable } from "../../src/output/table";
import type { AuditReport } from "../../src/agent/orchestrator";

const mockReport = (overrides: Partial<AuditReport> = {}): AuditReport => ({
  report: {
    summary: {
      totalDependencies: 5,
      totalAdvisories: 2,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      falsePositives: 1,
      scanDurationMs: 1234,
    },
    results: [
      {
        dependency: { name: "lodash", version: "4.17.20", type: "prod" },
        advisory: { id: "1", cveId: "CVE-2024-1234", severity: "CRITICAL", title: "Prototype Pollution", fixVersion: "4.17.21" },
        usage: "USED",
        usageEvidence: ["src/app.ts: Found import of lodash"],
        risk: "CRITICAL",
        confidence: 0.95,
      },
      {
        dependency: { name: "express", version: "4.18.0", type: "prod" },
        advisory: { id: "2", cveId: "CVE-2024-5678", severity: "HIGH", title: "Path traversal", fixVersion: null },
        usage: "NOT_USED",
        usageEvidence: [],
        risk: "NONE",
        confidence: 0.85,
      },
    ],
    metadata: {
      projectPath: "/test/project",
      llmProvider: "openai",
      llmModel: "gpt-4",
      scannedAt: "2024-06-29T12:00:00.000Z",
      mode: "full",
      sourcesUsed: ["npm-audit"],
    },
  },
  steps: [
    { name: "scan-project", status: "done", durationMs: 150 },
    { name: "compress-advisories", status: "done", durationMs: 300 },
    { name: "analyze-source", status: "done", durationMs: 500 },
  ],
  totalDurationMs: 1234,
  environment: { hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: true },
  ...overrides,
});

const noAdvisoriesReport = (): AuditReport => ({
  report: {
    summary: { totalDependencies: 3, totalAdvisories: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, falsePositives: 0, scanDurationMs: 100 },
    results: [],
    metadata: { projectPath: "/safe/project", llmProvider: "openai", llmModel: "gpt-4", scannedAt: "", mode: "quick", sourcesUsed: ["npm-audit"] },
  },
  steps: [{ name: "scan-project", status: "done", durationMs: 100 }],
  totalDurationMs: 100,
  environment: { hasPackageJson: true, hasLockfile: true, hasSourceDir: false, hasApiKey: false },
});

describe("formatTable", () => {
  it("contains header with project name", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("AI Dependency Auditor");
    expect(output).toContain("/test/project");
  });

  it("contains severity counts", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("CRITICAL: 1");
    expect(output).toContain("HIGH: 1");
    expect(output).toContain("FP: 1");
  });

  it("contains dependency details", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("lodash");
    expect(output).toContain("4.17.20");
    expect(output).toContain("CVE-2024-1234");
    expect(output).toContain("Prototype Pollution");
    expect(output).toContain("Fix: upgrade to 4.17.21");
  });

  it("shows usage and confidence", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("Usage: USED");
    expect(output).toContain("95% confidence");
    expect(output).toContain("Usage: NOT_USED");
  });

  it("shows 'No vulnerabilities' when no advisories", () => {
    const output = formatTable(noAdvisoriesReport());
    expect(output).toContain("No vulnerabilities found");
  });

  it("shows false positive count", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("false positive");
  });

  it("contains step summary", () => {
    const output = formatTable(mockReport());
    expect(output).toContain("scan-project");
    expect(output).toContain("done");
  });
});
