import { describe, it, expect, vi } from "vitest";
import { compressAdvisories } from "../../src/analysis/compressor";
import type { LlmClient } from "../../src/llm/openai-client";
import type { Advisory } from "../../src/types/advisory";

const mockAdvisories: readonly Advisory[] = [
  {
    id: "1",
    cveId: "CVE-2024-1234",
    source: "npm-audit",
    packageName: "lodash",
    affectedVersion: "4.17.20",
    fixVersion: "4.17.21",
    severity: "CRITICAL",
    title: "Prototype Pollution in lodash",
    description: "A prototype pollution vulnerability in lodash",
    vulnerableFunctions: ["merge", "set"],
    references: ["https://github.com/advisories/GHSA-1234"],
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
    title: "Path traversal in express",
    description: "A path traversal vulnerability",
    vulnerableFunctions: ["static"],
    references: [],
    publishedAt: null,
  },
  {
    id: "3",
    cveId: "CVE-2024-9012",
    source: "osv-dev",
    packageName: "axios",
    affectedVersion: "1.6.0",
    fixVersion: "1.6.1",
    severity: "MEDIUM",
    title: "SSRF in axios",
    description: "Server-side request forgery",
    vulnerableFunctions: [],
    references: [],
    publishedAt: "2024-03-01",
  },
];

const createMockClient = (mockFn: ReturnType<typeof vi.fn>): LlmClient => ({
  provider: "openai",
  model: "gpt-4",
  callLlm: mockFn,
});

describe("compressAdvisories", () => {
  it("returns empty result for empty input", async () => {
    const mockFn = vi.fn();
    const client = createMockClient(mockFn);

    const { result, stats } = await compressAdvisories(client, []);

    expect(result.advisories).toHaveLength(0);
    expect(result.totalInput).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(stats.inputCount).toBe(0);
    expect(stats.outputCount).toBe(0);
    expect(mockFn).not.toHaveBeenCalled();
  });

  it("parses JSON response into compressed advisories", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { cve_id: "CVE-2024-1234", severity: "CRITICAL", vulnerable_function: "merge", fix_version: "4.17.21" },
        { cve_id: "CVE-2024-5678", severity: "HIGH", vulnerable_function: "static", fix_version: null },
      ]),
      model: "gpt-4",
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      durationMs: 200,
    });
    const client = createMockClient(mockFn);

    const { result, stats } = await compressAdvisories(client, mockAdvisories);

    expect(result.advisories).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.totalInput).toBe(3);
    expect(result.advisories[0].cveId).toBe("CVE-2024-1234");
    expect(result.advisories[0].severity).toBe("CRITICAL");
    expect(result.advisories[0].vulnerableFunction).toBe("merge");
    expect(result.advisories[0].fixVersion).toBe("4.17.21");
    expect(result.advisories[1].cveId).toBe("CVE-2024-5678");
    expect(result.advisories[1].severity).toBe("HIGH");
    expect(result.advisories[1].fixVersion).toBeNull();
    expect(stats.inputCount).toBe(3);
    expect(stats.outputCount).toBe(2);
    expect(stats.removedCount).toBe(1);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockFn).toHaveBeenCalledOnce();
  });

  it("handles NONE response (all removed)", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      content: "NONE",
      model: "gpt-4",
      usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45 },
      durationMs: 100,
    });
    const client = createMockClient(mockFn);

    const { result, stats } = await compressAdvisories(client, mockAdvisories);

    expect(result.advisories).toHaveLength(0);
    expect(result.removedCount).toBe(3);
    expect(stats.outputCount).toBe(0);
    expect(stats.removedCount).toBe(3);
  });

  it("falls back to passthrough when LLM fails", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("API error"));
    const client = createMockClient(mockFn);

    const { result, stats } = await compressAdvisories(client, mockAdvisories);

    expect(result.advisories).toHaveLength(3);
    expect(result.removedCount).toBe(0);
    expect(stats.outputCount).toBe(3);
    expect(stats.removedCount).toBe(0);
  });

  it("treats all as removed when LLM returns invalid JSON", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      content: "not valid json at all",
      model: "gpt-4",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      durationMs: 50,
    });
    const client = createMockClient(mockFn);

    const { result, stats } = await compressAdvisories(client, mockAdvisories);

    expect(result.advisories).toHaveLength(0);
    expect(result.removedCount).toBe(3);
    expect(stats.outputCount).toBe(0);
    expect(stats.removedCount).toBe(3);
  });

  it("includes advisory id as cveId when cveId is null", async () => {
    const advisoriesNoCve: readonly Advisory[] = [
      {
        ...mockAdvisories[0],
        cveId: null,
      },
    ];

    const mockFn = vi.fn().mockRejectedValue(new Error("fallback"));
    const client = createMockClient(mockFn);

    const { result } = await compressAdvisories(client, advisoriesNoCve);

    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0].cveId).toBe("1");
  });

  it("passes system and user prompts to LLM", async () => {
    let capturedSystemPrompt = "";
    let capturedUserPrompt = "";
    const mockFn = vi.fn().mockImplementation(async (sp: string, up: string) => {
      capturedSystemPrompt = sp;
      capturedUserPrompt = up;
      return {
        content: JSON.stringify([]),
        model: "gpt-4",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: 0,
      };
    });
    const client = createMockClient(mockFn);

    await compressAdvisories(client, mockAdvisories);

    expect(mockFn).toHaveBeenCalledOnce();
    expect(capturedSystemPrompt).toContain("security filter");
    expect(capturedUserPrompt).toContain("lodash");
    expect(capturedUserPrompt).toContain("express");
    expect(capturedUserPrompt).toContain("axios");
    expect(capturedUserPrompt).toContain("CVE-2024-1234");
  });
});
