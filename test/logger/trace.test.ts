import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { sanitize, sanitizeString, sanitizeUrl, createLogger } from "../../src/logger/index";
import { TraceRecorder } from "../../src/logger/trace";
import type { AuditReport } from "../../src/agent/orchestrator";
import type { AppConfig } from "../../src/types/config";
import type { EnvironmentInfo } from "../../src/agent/tools";

const makeTempDir = (): string => {
  const dir = resolve(tmpdir(), `dep-audit-trace-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const mockAuditReport = (): AuditReport => ({
  report: {
    summary: {
      totalDependencies: 5,
      totalAdvisories: 3,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      lowCount: 0,
      falsePositives: 1,
      scanDurationMs: 1234,
    },
    results: [
      {
        dependency: { name: "lodash", version: "4.17.20", type: "prod" },
        advisory: { id: "GHSA-xxxx", cveId: "CVE-2024-0001", severity: "HIGH", title: "Prototype pollution", fixVersion: "4.17.21" },
        usage: "USED",
        usageEvidence: ["src/index.ts:3: import lodash from 'lodash'"],
        risk: "HIGH",
        confidence: 0.95,
      },
    ],
    metadata: {
      projectPath: "/test/project",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      scannedAt: "2026-06-29T12:00:00.000Z",
      mode: "full",
      sourcesUsed: ["npm-audit", "osv-dev"],
    },
  },
  steps: [
    { name: "scan-project", status: "done", durationMs: 500 },
    { name: "compress-advisories", status: "done", durationMs: 300 },
    { name: "analyze-source", status: "done", durationMs: 400 },
  ],
  totalDurationMs: 1234,
  environment: { hasPackageJson: true, hasLockfile: true, hasSourceDir: true, hasApiKey: true } as EnvironmentInfo,
});

const mockConfig = (): AppConfig => ({
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-my-secret-api-key-12345",
    temperature: 0,
    maxTokens: 16384,
  },
  audit: { topK: 10, cacheTtlHours: 24, strictMode: false, format: "table" },
  mode: "full",
});

describe("sanitize", () => {
  it("redacts apiKey field", () => {
    const result = sanitize({ apiKey: "sk-1234567890abcdef" });
    expect(result.apiKey).toBe("***REDACTED***");
  });

  it("redacts token field", () => {
    const result = sanitize({ token: "ghp_1234567890abcdef" });
    expect(result.token).toBe("***REDACTED***");
  });

  it("redacts secret field", () => {
    const result = sanitize({ secret: "my-secret-value" });
    expect(result.secret).toBe("***REDACTED***");
  });

  it("redacts password field", () => {
    const result = sanitize({ password: "hunter2" });
    expect(result.password).toBe("***REDACTED***");
  });

  it("redacts Authorization header", () => {
    const result = sanitize({ Authorization: "Bearer sk-1234567890abcdef" });
    expect(result.Authorization).toBe("***REDACTED***");
  });

  it("redacts API key in string value with sensitive key name", () => {
    const result = sanitize({ myApiKey: "sk-1234567890abcdef" });
    expect(result.myApiKey).toBe("***REDACTED***");
  });

  it("redacts sk- prefixed keys in string values", () => {
    const result = sanitize({ message: "using key sk-abcdefghijklmnopqrst" });
    expect(result.message).toBe("using key sk-***REDACTED***");
  });

  it("redacts bearer token inline in string values", () => {
    const result = sanitize({ header: "Authorization: Bearer ghp_1234567890abcdef" });
    expect(result.header).toBe("Authorization: bearer ***REDACTED***");
  });

  it("passes through safe data unchanged", () => {
    const data = { name: "lodash", version: "4.17.20", severity: "HIGH" };
    const result = sanitize(data);
    expect(result).toEqual(data);
  });

  it("handles nested objects recursively", () => {
    const data = { llm: { apiKey: "sk-secret", model: "gpt-4" } };
    const result = sanitize(data);
    expect((result.llm as Record<string, unknown>).apiKey).toBe("***REDACTED***");
    expect((result.llm as Record<string, unknown>).model).toBe("gpt-4");
  });

  it("handles null and numeric values", () => {
    const result = sanitize({ count: 42, value: null, flag: true });
    expect(result.count).toBe(42);
    expect(result.value).toBeNull();
    expect(result.flag).toBe(true);
  });
});

describe("sanitizeString", () => {
  it("redacts inline apiKey assignment", () => {
    expect(sanitizeString("apiKey=sk-1234567890abcdef")).toMatch(/\*\*\*REDACTED\*\*\*/);
  });

  it("redacts inline token assignment", () => {
    expect(sanitizeString("token=ghp_1234567890abcdef")).toMatch(/\*\*\*REDACTED\*\*\*/);
  });

  it("redacts inline secret assignment", () => {
    expect(sanitizeString("secret=my-secret-value")).toMatch(/\*\*\*REDACTED\*\*\*/);
  });

  it("redacts bearer token in string", () => {
    expect(sanitizeString("Authorization: Bearer sk-1234567890abcdef")).toMatch(/\*\*\*REDACTED\*\*\*/);
  });

  it("redacts OpenAI-style keys", () => {
    expect(sanitizeString("sk-abcdefghijklmnopqrstuvwx")).toBe("sk-***REDACTED***");
  });

  it("passes through safe strings", () => {
    expect(sanitizeString("lodash@4.17.20")).toBe("lodash@4.17.20");
  });
});

describe("sanitizeUrl", () => {
  it("redacts api_key query parameter", () => {
    expect(sanitizeUrl("https://api.example.com?api_key=sk-123")).not.toContain("sk-123");
  });

  it("redacts key query parameter", () => {
    expect(sanitizeUrl("https://api.example.com?key=abc123")).not.toContain("abc123");
  });

  it("redacts token query parameter", () => {
    expect(sanitizeUrl("https://api.example.com?token=ghp_xxx")).not.toContain("ghp_xxx");
  });

  it("preserves URL without sensitive params", () => {
    expect(sanitizeUrl("https://api.osv.dev/v1/querybatch")).toBe("https://api.osv.dev/v1/querybatch");
  });

  it("handles invalid URLs gracefully", () => {
    expect(sanitizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("TraceRecorder", () => {
  let tracesDir: string;
  let recorder: TraceRecorder;

  beforeEach(() => {
    tracesDir = makeTempDir();
    recorder = new TraceRecorder(tracesDir);
  });

  afterEach(() => {
    try {
      if (existsSync(tracesDir)) rmSync(tracesDir, { recursive: true, force: true });
    } catch { /* ignore cleanup failures */ }
  });

  it("creates a trace file with .json extension", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    expect(path).not.toBeNull();
    expect(path).toMatch(/\.json$/);
    expect(existsSync(path!)).toBe(true);
  });

  it("trace file contains valid JSON", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const content = readFileSync(path!, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("trace file contains report data", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.report.summary.totalDependencies).toBe(5);
    expect(data.report.summary.totalAdvisories).toBe(3);
  });

  it("trace file sanitizes API keys from config", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const raw = readFileSync(path!, "utf-8");
    expect(raw).not.toContain("sk-my-secret-api-key-12345");
    expect(raw).toContain("***REDACTED***");
  });

  it("trace file contains steps", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.steps).toHaveLength(3);
  });

  it("trace file contains environment info", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.environment.hasPackageJson).toBe(true);
    expect(data.environment.hasLockfile).toBe(true);
  });

  it("trace file contains totalDurationMs", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.totalDurationMs).toBe(1234);
  });

  it("trace file contains version field", () => {
    const path = recorder.record(mockAuditReport(), mockConfig());
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.version).toBe(1);
  });

  it("detects LangSmith when env vars are set", () => {
    const prevTracing = process.env["LANGSMITH_TRACING_V2"];
    const prevKey = process.env["LANGCHAIN_API_KEY"];
    process.env["LANGSMITH_TRACING_V2"] = "true";
    process.env["LANGCHAIN_API_KEY"] = "lsv2_abc123";
    try {
      expect(recorder.isLangSmithEnabled).toBe(true);
    } finally {
      if (prevTracing !== undefined) process.env["LANGSMITH_TRACING_V2"] = prevTracing;
      else delete process.env["LANGSMITH_TRACING_V2"];
      if (prevKey !== undefined) process.env["LANGCHAIN_API_KEY"] = prevKey;
      else delete process.env["LANGCHAIN_API_KEY"];
    }
  });

  it("reports LangSmith disabled when env vars are missing", () => {
    const prevTracing = process.env["LANGSMITH_TRACING_V2"];
    const prevKey = process.env["LANGCHAIN_API_KEY"];
    delete process.env["LANGSMITH_TRACING_V2"];
    delete process.env["LANGCHAIN_API_KEY"];
    try {
      expect(recorder.isLangSmithEnabled).toBe(false);
    } finally {
      if (prevTracing !== undefined) process.env["LANGSMITH_TRACING_V2"] = prevTracing;
      if (prevKey !== undefined) process.env["LANGCHAIN_API_KEY"] = prevKey;
    }
  });

  it("handles report with empty results", () => {
    const emptyReport = mockAuditReport();
    emptyReport.report.results = [];
    emptyReport.report.summary.totalAdvisories = 0;
    const path = recorder.record(emptyReport, mockConfig());
    const data: { report: { results: unknown[] } } = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.report.results).toHaveLength(0);
  });
});

describe("createLogger", () => {
  it("creates a logger with info, warn, error, debug methods", () => {
    const log = createLogger("test", "info");
    expect(log.info).toBeInstanceOf(Function);
    expect(log.warn).toBeInstanceOf(Function);
    expect(log.error).toBeInstanceOf(Function);
    expect(log.debug).toBeInstanceOf(Function);
    expect(log.child).toBeInstanceOf(Function);
  });

  it("child logger adds prefix", () => {
    const parent = createLogger("parent", "info");
    const child = parent.child("child");
    expect(child).toBeDefined();
    expect(child.info).toBeInstanceOf(Function);
  });
});
