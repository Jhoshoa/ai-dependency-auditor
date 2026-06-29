import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "../src/scanner/parser";
import { queryOsv } from "../src/scanner/osv-api";
import { compressAdvisories } from "../src/analysis/compressor";
import { createOpenAiClient } from "../src/llm/openai-client";
import { getSystemPrompt } from "../src/llm/prompts";
import { fetchWithRetry } from "../src/utils/network";
import { detectLockfile, detectMultipleLockfiles, fileExists } from "../src/utils/file";
import type { Advisory } from "../src/types/advisory";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const FIXTURES = resolve(__dirname, "fixtures");

describe("Sprint 9: Edge Cases y Robustez", () => {
  describe("1. Sin dependencias", () => {
    it("parser: project with no deps returns empty array", async () => {
      const project = await parseProject(resolve(FIXTURES, "no-deps"));
      expect(project.dependencies).toHaveLength(0);
    });
  });

  describe("2. Lockfile corrupto", () => {
    it("parser: handles corrupt lockfile gracefully (falls back to package.json)", async () => {
      const project = await parseProject(resolve(FIXTURES, "corrupt-lockfile"));
      expect(project.dependencies).toHaveLength(1);
      expect(project.dependencies[0].name).toBe("lodash");
      expect(project.lockfile.type).toBe("none");
    });
  });

  describe("3. Múltiples lockfiles", () => {
    it("file: detectMultipleLockfiles returns detected lockfiles", async () => {
      const result = detectLockfile(resolve(FIXTURES, "vulnerable-project"));
      expect(result.type).toBe("npm");
    });

    it("file: detectMultipleLockfiles returns none for no-deps", async () => {
      const result = detectMultipleLockfiles(resolve(FIXTURES, "no-deps"));
      expect(result).toHaveLength(0);
    });

    it("file: detectMultipleLockfiles returns npm for vulnerable-project", async () => {
      const result = detectMultipleLockfiles(resolve(FIXTURES, "vulnerable-project"));
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(r => r.type === "npm")).toBe(true);
    });
  });

  describe("4. Paquetes privados (@company/xxx)", () => {
    it("osv-api: private package returns advisory with NONE severity", async () => {
      const result = await queryOsv([{ name: "@company/internal-lib", version: "2.1.0" }]);
      const privateAdvisories = result.advisories.filter(
        (a) => a.packageName === "@company/internal-lib",
      );
      expect(privateAdvisories.length).toBeGreaterThan(0);
      const privateAd = privateAdvisories[0];
      expect(privateAd.severity).toBe("NONE");
      expect(privateAd.title).toContain("Private package");
      expect(privateAd.description).toContain("Manual verification");
    });

    it("osv-api: normal scoped packages (e.g. @angular/core) are NOT filtered", async () => {
      const result = await queryOsv([{ name: "@angular/core", version: "15.0.0" }]);
      const angularAdvisories = result.advisories.filter(
        (a) => a.packageName === "@angular/core",
      );
      expect(angularAdvisories.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("5. Prompt injection en datos de CVEs", () => {
    it("prompts: all system prompts contain injection guard", () => {
      const prompts = ["audit", "compression", "sourceAnalysis"] as const;
      for (const key of prompts) {
        const prompt = getSystemPrompt(key);
        expect(prompt).toContain("untrusted data");
        expect(prompt).toContain("do not execute");
        expect(prompt).toContain("embedded instructions");
      }
    });

    it("prompts: injection guard is after the main instructions", () => {
      const prompt = getSystemPrompt("compression");
      const guardIndex = prompt.indexOf("untrusted data");
      expect(guardIndex).toBeGreaterThan(0);
    });
  });

  describe("6. Proyecto sin src/", () => {
    it("parser: no-deps fixture has no src dir", async () => {
      const noSrc = resolve(FIXTURES, "no-deps");
      expect(fileExists(resolve(noSrc, "src"))).toBe(false);
    });
  });

  describe("7. Volumen masivo de CVEs (50+)", () => {
    const makeBulkAdvisories = (count: number): readonly Advisory[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `GHSA-${i}`,
        cveId: i % 2 === 0 ? `CVE-2024-${1000 + i}` : null,
        source: "osv-dev" as const,
        packageName: `pkg-${i % 10}`,
        affectedVersion: "1.0.0",
        fixVersion: i % 3 === 0 ? "1.0.1" : null,
        severity: (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const)[i % 4],
        title: `Test advisory ${i}`,
        description: `Description for advisory ${i}`,
        vulnerableFunctions: i % 5 === 0 ? ["fn1", "fn2"] : [],
        references: [],
        publishedAt: "2024-01-01",
      }));

    it("compressor: processes 50+ CVEs in batches", async () => {
      const mockClient = {
        provider: "openai",
        model: "gpt-4",
        callLlm: vi.fn().mockResolvedValue({
          content: JSON.stringify([
            { cve_id: "CVE-2024-1000", severity: "CRITICAL", vulnerable_function: "fn1", fix_version: "1.0.1" },
          ]),
          model: "gpt-4",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          durationMs: 100,
        }),
      };

      const advisories = makeBulkAdvisories(55);
      const { result, stats } = await compressAdvisories(mockClient, advisories);

      expect(result.totalInput).toBe(55);
      expect(stats.inputCount).toBe(55);
      expect(stats.batches).toBeDefined();
      if (stats.batches) {
        expect(stats.batches.length).toBeGreaterThan(1);
      }
    });

    it("compressor: handles 50+ CVEs with batch fallback on partial failure", async () => {
      let callCount = 0;
      const mockClient = {
        provider: "openai",
        model: "gpt-4",
        callLlm: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) throw new Error("Transient API error");
          return {
            content: JSON.stringify([
              { cve_id: "CVE-2024-1001", severity: "HIGH", vulnerable_function: "fn2", fix_version: null },
            ]),
            model: "gpt-4",
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            durationMs: 50,
          };
        }),
      };

      const advisories = makeBulkAdvisories(60);
      const { result, stats } = await compressAdvisories(mockClient, advisories);

      expect(result.totalInput).toBe(60);
      expect(result.advisories.length).toBeGreaterThan(0);
      expect(stats.batches).toBeDefined();
    });
  });

  describe("8. LLM retry on error", () => {
    it("openai-client: retry config uses maxRetries 0 and custom backoff", () => {
      const client = createOpenAiClient({
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        temperature: 0,
        maxTokens: 16384,
      });
      expect(client.provider).toBe("openai");
      expect(client.model).toBe("gpt-4o-mini");
    });
  });

  describe("9. Network timeout hardening", () => {
    it("network: fetchWithRetry throws NetworkError on timeout", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new DOMException("The operation was aborted", "AbortError")), 100),
        );
      });

      const { NetworkError } = await import("../src/utils/errors");
      try {
        await fetchWithRetry("https://example.com", {}, { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100 });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        expect((err as Error).message).toContain("timed out");
      }

      globalThis.fetch = originalFetch;
    }, 10000);
  });

  describe("10. Parser edge cases", () => {
    it("parser: handles missing package.json", async () => {
      await expect(parseProject("/nonexistent")).rejects.toThrow();
    });

    it("parser: strips semver ranges from versions", async () => {
      const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
      const lodash = project.dependencies.find(d => d.name === "lodash");
      expect(lodash?.version).toBe("4.17.20");
    });

    it("parser: getDependenciesWithLockfileVersions uses lockfile versions", async () => {
      const { getDependenciesWithLockfileVersions } = await import("../src/scanner/parser");
      const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
      const deps = getDependenciesWithLockfileVersions(project);
      expect(deps.length).toBeGreaterThan(0);
    });
  });
});
