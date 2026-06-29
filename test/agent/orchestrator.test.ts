import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig, AuditMode } from "../../src/types/config";
import type { Logger } from "../../src/logger";

const mockScanProject = vi.fn();
const mockCreateLlmClient = vi.fn();
const mockCompressAdvisories = vi.fn();
const mockAnalyzeSourceUsage = vi.fn();

vi.mock("../../src/scanner", () => ({ scanProject: mockScanProject }));
vi.mock("../../src/llm", () => ({ createLlmClient: mockCreateLlmClient }));
vi.mock("../../src/analysis", () => ({
  compressAdvisories: mockCompressAdvisories,
  analyzeSourceUsage: mockAnalyzeSourceUsage,
}));

const { runAudit } = await import("../../src/agent/orchestrator");

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const makeConfig = (mode: AuditMode): AppConfig => ({
  mode,
  llm: {
    provider: "openai",
    model: "gpt-4",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    temperature: 0.7,
    maxTokens: 1024,
  },
  audit: {
    topK: 10,
    cacheTtlHours: 24,
    strictMode: false,
    format: "table",
  },
});

const mockScanResult = (overrides: Record<string, unknown> = {}) => ({
  project: { path: "/test/project", name: "test-project", dependencies: [], lockfile: { type: "npm" as const, path: "/test/project/package-lock.json", packages: new Map() } },
  dependencies: [
    { name: "lodash", version: "4.17.20", type: "prod" as const },
    { name: "express", version: "4.18.0", type: "prod" as const },
  ],
  advisories: [
    {
      id: "1",
      cveId: "CVE-2024-1234",
      source: "npm-audit",
      packageName: "lodash",
      affectedVersion: "4.17.20",
      fixVersion: "4.17.21",
      severity: "CRITICAL",
      title: "Prototype Pollution",
      description: "A prototype pollution vulnerability",
      vulnerableFunctions: ["merge"],
      references: [],
      publishedAt: "2024-01-01",
    },
    {
      id: "2",
      cveId: "CVE-2024-5678",
      source: "npm-audit",
      packageName: "express",
      affectedVersion: "4.18.0",
      fixVersion: null,
      severity: "HIGH",
      title: "Path traversal",
      description: "A path traversal vulnerability",
      vulnerableFunctions: ["static"],
      references: [],
      publishedAt: null,
    },
  ],
  sourcesUsed: ["npm-audit"],
  scanDurationMs: 100,
  ...overrides,
});

const mockLlmClient = {
  provider: "openai",
  model: "gpt-4",
  callLlm: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateLlmClient.mockResolvedValue(mockLlmClient);
});

describe("runAudit", () => {
  it("scans project in quick mode without LLM calls", async () => {
    mockScanProject.mockResolvedValue(mockScanResult());

    const result = await runAudit(makeConfig("quick"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCreateLlmClient).not.toHaveBeenCalled();
    expect(mockCompressAdvisories).not.toHaveBeenCalled();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.report.metadata.mode).toBe("quick");
    expect(result.report.summary.totalAdvisories).toBe(2);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].name).toBe("scan");
    expect(result.steps[0].status).toBe("done");
    expect(result.steps[1].name).toBe("compress");
    expect(result.steps[1].status).toBe("skipped");
    expect(result.steps[2].name).toBe("source-analysis");
    expect(result.steps[2].status).toBe("skipped");
  });

  it("runs full audit with compression and source analysis", async () => {
    mockScanProject.mockResolvedValue(mockScanResult());
    mockCompressAdvisories.mockResolvedValue({
      result: {
        advisories: [
          { cveId: "CVE-2024-1234", severity: "CRITICAL", vulnerableFunction: "merge", fixVersion: "4.17.21" },
        ],
        removedCount: 1,
        totalInput: 2,
      },
      stats: { inputCount: 2, outputCount: 1, removedCount: 1, durationMs: 50 },
    });
    mockAnalyzeSourceUsage.mockResolvedValue({
      usage: "USED",
      evidence: ["Found import of lodash"],
      confidence: 0.9,
    });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(2);
    expect(mockCompressAdvisories).toHaveBeenCalledOnce();
    expect(mockAnalyzeSourceUsage).toHaveBeenCalledOnce();
    expect(result.report.metadata.mode).toBe("full");
    expect(result.report.summary.totalAdvisories).toBe(2);
    expect(result.report.results).toHaveLength(1);
    expect(result.report.results[0].usage).toBe("USED");
    expect(result.report.results[0].risk).toBe("CRITICAL");
    expect(result.report.results[0].confidence).toBe(0.9);
    expect(result.steps[0].status).toBe("done");
    expect(result.steps[1].status).toBe("done");
    expect(result.steps[2].status).toBe("done");
  });

  it("handles quick mode with no advisories", async () => {
    mockScanProject.mockResolvedValue(mockScanResult({ advisories: [], dependencies: [] }));

    const result = await runAudit(makeConfig("quick"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCompressAdvisories).not.toHaveBeenCalled();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.report.summary.totalAdvisories).toBe(0);
    expect(result.report.results).toHaveLength(0);
    expect(result.steps).toHaveLength(1);
  });

  it("handles full mode with no advisories", async () => {
    mockScanProject.mockResolvedValue(mockScanResult({ advisories: [], dependencies: [] }));

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCompressAdvisories).not.toHaveBeenCalled();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.report.summary.totalAdvisories).toBe(0);
    expect(result.steps).toHaveLength(1);
  });

  it("falls back when compression fails in full mode", async () => {
    mockScanProject.mockResolvedValue(mockScanResult());
    mockCompressAdvisories.mockRejectedValue(new Error("LLM error"));

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockCompressAdvisories).toHaveBeenCalledOnce();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.report.summary.totalAdvisories).toBe(2);
    expect(result.steps[1].status).toBe("failed");
    expect(result.steps[2].status).toBe("skipped");
  });

  it("includes correct summary counts", async () => {
    mockScanProject.mockResolvedValue(mockScanResult());
    mockCompressAdvisories.mockResolvedValue({
      result: {
        advisories: [
          { cveId: "CVE-2024-1234", severity: "CRITICAL", vulnerableFunction: "merge", fixVersion: "4.17.21" },
          { cveId: "CVE-2024-5678", severity: "HIGH", vulnerableFunction: "static", fixVersion: null },
        ],
        removedCount: 0,
        totalInput: 2,
      },
      stats: { inputCount: 2, outputCount: 2, removedCount: 0, durationMs: 50 },
    });
    mockAnalyzeSourceUsage
      .mockResolvedValueOnce({ usage: "USED", evidence: [], confidence: 0.9 })
      .mockResolvedValueOnce({ usage: "NOT_USED", evidence: [], confidence: 1 });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(result.report.summary.criticalCount).toBe(1);
    expect(result.report.summary.highCount).toBe(0);
    expect(result.report.summary.falsePositives).toBe(1);
    expect(result.report.results).toHaveLength(2);
    expect(result.report.results[0].risk).toBe("CRITICAL");
    expect(result.report.results[0].usage).toBe("USED");
    expect(result.report.results[1].risk).toBe("NONE");
    expect(result.report.results[1].usage).toBe("NOT_USED");
  });
});
