import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig, AuditMode } from "../../src/types/config";
import type { Logger } from "../../src/logger";

const mockCheckEnvironment = vi.fn();
const mockScanProject = vi.fn();
const mockCreateLlmClient = vi.fn();
const mockCompressAdvisories = vi.fn();
const mockAnalyzeSourceUsage = vi.fn();

vi.mock("../../src/agent/tools", async () => {
  const actual = await vi.importActual("../../src/agent/tools");
  return { ...actual, checkEnvironment: mockCheckEnvironment };
});

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

const makeConfig = (mode: AuditMode, overrides: Partial<AppConfig> = {}): AppConfig => ({
  mode,
  llm: {
    provider: "openai",
    model: "gpt-4",
    baseUrl: "https://api.openai.com/v1",
    apiKey: mode === "full" ? "sk-test" : null,
    temperature: 0.7,
    maxTokens: 1024,
  },
  audit: {
    topK: 10,
    cacheTtlHours: 24,
    strictMode: false,
    format: "table",
  },
  ...overrides,
});

const baseScanResult = {
  project: { path: "/test/project", name: "test-project", dependencies: [], lockfile: { type: "npm" as const, path: "/test/project/package-lock.json", packages: new Map() } },
  dependencies: [
    { name: "lodash", version: "4.17.20", type: "prod" as const },
  ],
  advisories: [
    {
      id: "1", cveId: "CVE-2024-1234", source: "npm-audit" as const,
      packageName: "lodash", affectedVersion: "4.17.20", fixVersion: "4.17.21",
      severity: "CRITICAL", title: "Prototype Pollution", description: "vuln",
      vulnerableFunctions: ["merge"], references: [], publishedAt: "2024-01-01",
    },
  ],
  sourcesUsed: ["npm-audit"],
  scanDurationMs: 100,
};

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
  it("quick mode with advisories — skips LLM steps", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: false });
    mockScanProject.mockResolvedValue(baseScanResult);

    const result = await runAudit(makeConfig("quick"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCreateLlmClient).not.toHaveBeenCalled();
    expect(mockCompressAdvisories).not.toHaveBeenCalled();
    expect(result.report.metadata.mode).toBe("quick");
    expect(result.report.summary.totalAdvisories).toBe(1);
    expect(result.report.results).toHaveLength(1);
    expect(result.environment.hasApiKey).toBe(false);
    expect(result.steps.find(s => s.name === "compress-advisories")?.status).toBe("skipped");
    expect(result.steps.find(s => s.name === "analyze-source")?.status).toBe("skipped");
  });

  it("full mode with API key + src/ — runs compression and analysis", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: true });
    mockScanProject.mockResolvedValue(baseScanResult);
    mockCompressAdvisories.mockResolvedValue({
      result: { advisories: [{ cveId: "CVE-2024-1234", severity: "CRITICAL", vulnerableFunction: "merge", fixVersion: "4.17.21" }], removedCount: 0, totalInput: 1 },
      stats: { inputCount: 1, outputCount: 1, removedCount: 0, durationMs: 50 },
    });
    mockAnalyzeSourceUsage.mockResolvedValue({ usage: "USED", evidence: ["Found merge call"], confidence: 0.9 });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockScanProject).toHaveBeenCalledOnce();
    expect(mockCreateLlmClient).toHaveBeenCalledTimes(2);
    expect(mockCompressAdvisories).toHaveBeenCalledOnce();
    expect(mockAnalyzeSourceUsage).toHaveBeenCalledOnce();
    expect(result.report.results).toHaveLength(1);
    expect(result.report.results[0].usage).toBe("USED");
    expect(result.report.results[0].risk).toBe("CRITICAL");
    expect(result.steps.find(s => s.name === "compress-advisories")?.status).toBe("done");
    expect(result.steps.find(s => s.name === "analyze-source")?.status).toBe("done");
    expect(result.environment.hasSourceDir).toBe(true);
    expect(result.environment.hasApiKey).toBe(true);
  });

  it("full mode without API key — skips LLM steps, quick fallback", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: false });
    mockScanProject.mockResolvedValue(baseScanResult);

    const result = await runAudit(makeConfig("full", { llm: { ...makeConfig("full").llm, apiKey: null } }), "/test/project", mockLogger);

    expect(mockCreateLlmClient).not.toHaveBeenCalled();
    expect(mockCompressAdvisories).not.toHaveBeenCalled();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.steps.find(s => s.name === "compress-advisories")?.status).toBe("skipped");
    expect(result.steps.find(s => s.name === "analyze-source")?.status).toBe("skipped");
  });

  it("full mode without src/ — skips source analysis", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: false, hasApiKey: true });
    mockScanProject.mockResolvedValue(baseScanResult);
    mockCompressAdvisories.mockResolvedValue({
      result: { advisories: [{ cveId: "CVE-2024-1234", severity: "CRITICAL", vulnerableFunction: "merge", fixVersion: "4.17.21" }], removedCount: 0, totalInput: 1 },
      stats: { inputCount: 1, outputCount: 1, removedCount: 0, durationMs: 50 },
    });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockCompressAdvisories).toHaveBeenCalledOnce();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.steps.find(s => s.name === "compress-advisories")?.status).toBe("done");
    expect(result.steps.find(s => s.name === "analyze-source")?.status).toBe("skipped");
    expect(result.report.results[0].usage).toBe("CANT_DETERMINE");
  });

  it("no package.json — empty report", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: false, hasLockfile: false, hasSourceDir: false, hasApiKey: false });

    const result = await runAudit(makeConfig("quick"), "/test/project", mockLogger);

    expect(mockScanProject).not.toHaveBeenCalled();
    expect(result.report.summary.totalAdvisories).toBe(0);
    expect(result.steps).toHaveLength(0);
  });

  it("no advisories — empty result", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: true });
    mockScanProject.mockResolvedValue({ ...baseScanResult, advisories: [] });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockCreateLlmClient).not.toHaveBeenCalled();
    expect(result.report.summary.totalAdvisories).toBe(0);
    expect(result.report.results).toHaveLength(0);
  });

  it("compression failure — fallback gracefully", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: true });
    mockScanProject.mockResolvedValue(baseScanResult);
    mockCompressAdvisories.mockRejectedValue(new Error("LLM down"));

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(mockCompressAdvisories).toHaveBeenCalledOnce();
    expect(mockAnalyzeSourceUsage).not.toHaveBeenCalled();
    expect(result.steps.find(s => s.name === "compress-advisories")?.status).toBe("failed");
    expect(result.steps.find(s => s.name === "analyze-source")?.status).toBe("skipped");
  });

  it("includes environment info in the result", async () => {
    mockCheckEnvironment.mockReturnValue({ hasPackageJson: true, hasLockfile: false, hasSourceDir: true, hasApiKey: true });
    mockScanProject.mockResolvedValue({ ...baseScanResult, sourcesUsed: ["osv-dev"] });

    const result = await runAudit(makeConfig("full"), "/test/project", mockLogger);

    expect(result.environment.hasPackageJson).toBe(true);
    expect(result.environment.hasLockfile).toBe(false);
    expect(result.environment.hasSourceDir).toBe(true);
    expect(result.environment.hasApiKey).toBe(true);
  });
});
