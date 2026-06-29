import { describe, it, expect } from "vitest";
import { formatJson } from "../../src/output/json";
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
      sourcesUsed: ["npm-audit", "osv-dev"],
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

describe("formatJson", () => {
  it("returns valid JSON", () => {
    const output = formatJson(mockReport());
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes summary with all fields", () => {
    const parsed = JSON.parse(formatJson(mockReport()));
    expect(parsed.summary.totalDependencies).toBe(5);
    expect(parsed.summary.totalAdvisories).toBe(2);
    expect(parsed.summary.criticalCount).toBe(1);
    expect(parsed.summary.highCount).toBe(1);
    expect(parsed.summary.falsePositives).toBe(1);
    expect(parsed.summary.scanDurationMs).toBe(1234);
  });

  it("includes results with usage analysis", () => {
    const parsed = JSON.parse(formatJson(mockReport()));
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].usage).toBe("USED");
    expect(parsed.results[0].risk).toBe("CRITICAL");
    expect(parsed.results[0].confidence).toBe(0.95);
    expect(parsed.results[1].usage).toBe("NOT_USED");
    expect(parsed.results[1].risk).toBe("NONE");
  });

  it("includes metadata", () => {
    const parsed = JSON.parse(formatJson(mockReport()));
    expect(parsed.metadata.llmProvider).toBe("openai");
    expect(parsed.metadata.mode).toBe("full");
    expect(parsed.metadata.sourcesUsed).toEqual(["npm-audit", "osv-dev"]);
  });

  it("includes steps array", () => {
    const parsed = JSON.parse(formatJson(mockReport()));
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[0].name).toBe("scan-project");
    expect(parsed.steps[0].status).toBe("done");
    expect(parsed.steps[0].durationMs).toBe(150);
  });

  it("includes totalDurationMs", () => {
    const parsed = JSON.parse(formatJson(mockReport()));
    expect(parsed.totalDurationMs).toBe(1234);
  });

  it("handles empty results", () => {
    const empty = mockReport({
      report: {
        summary: { totalDependencies: 0, totalAdvisories: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, falsePositives: 0, scanDurationMs: 0 },
        results: [],
        metadata: { projectPath: ".", llmProvider: "openai", llmModel: "gpt-4", scannedAt: "", mode: "quick", sourcesUsed: [] },
      },
      steps: [],
      totalDurationMs: 0,
    });
    const parsed = JSON.parse(formatJson(empty));
    expect(parsed.results).toHaveLength(0);
    expect(parsed.steps).toHaveLength(0);
  });
});
