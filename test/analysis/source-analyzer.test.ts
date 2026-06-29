import { describe, it, expect, vi } from "vitest";
import { analyzeSourceUsage } from "../../src/analysis/source-analyzer";
import type { LlmClient } from "../../src/llm/openai-client";
import type { SourceFileInfo } from "../../src/analysis/source-analyzer";

const makeClient = (mockFn: ReturnType<typeof vi.fn>): LlmClient => ({
  provider: "openai",
  model: "gpt-4",
  callLlm: mockFn,
});

const makeFile = (path: string, content: string): SourceFileInfo => ({ path, content });

describe("analyzeSourceUsage", () => {
  it("returns NOT_USED when package is not imported", async () => {
    const client = makeClient(vi.fn());
    const files = [makeFile("src/index.ts", "import fs from 'node:fs';\nconsole.log('hello');")];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("NOT_USED");
    expect(result.evidence).toHaveLength(0);
    expect(result.confidence).toBe(1);
  });

  it("returns USED with function call evidence", async () => {
    const client = makeClient(vi.fn());
    const files = [makeFile("src/app.ts", `import { merge } from "lodash";\nmerge({}, { a: 1 });`)];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("USED");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.some(e => e.includes("Called"))).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it("detects require usage without direct calls", async () => {
    const client = makeClient(vi.fn().mockResolvedValue({
      content: JSON.stringify({ usage: "USED", evidence: ["requiring the package is sufficient"], confidence: 0.8 }),
      model: "gpt-4",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      durationMs: 50,
    }));
    const files = [makeFile("src/app.ts", `const _ = require("lodash");`)];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("USED");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toContain("require");
  });

  it("detects ESM import usage", async () => {
    const client = makeClient(vi.fn());
    const files = [makeFile("src/app.ts", `import _ from "lodash";`)];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("CANT_DETERMINE");
    expect(result.evidence.some(e => e.includes("import"))).toBe(true);
  });

  it("returns CANT_DETERMINE when LLM call fails", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("API error"));
    const client = makeClient(mockFn);
    const files = [makeFile("src/app.ts", `import { merge } from "lodash";`)];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("CANT_DETERMINE");
    expect(result.confidence).toBe(0.5);
  });

  it("handles multiple source files", async () => {
    const client = makeClient(vi.fn());
    const files = [
      makeFile("src/utils.ts", `export const noop = () => {};`),
      makeFile("src/app.ts", `import { merge } from "lodash";\nmerge({ a: 1 }, { b: 2 });`),
    ];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("USED");
    expect(result.evidence.some(e => e.includes("src/app.ts"))).toBe(true);
  });

  it("detects dynamic imports", async () => {
    const client = makeClient(vi.fn());
    const files = [makeFile("src/app.ts", `const mod = await import("lodash");`)];

    const result = await analyzeSourceUsage(client, "lodash", ["merge"], files);

    expect(result.usage).toBe("CANT_DETERMINE");
    expect(result.evidence.some(e => e.includes("dynamic import"))).toBe(true);
  });

  it("handles scoped packages", async () => {
    const client = makeClient(vi.fn());
    const files = [makeFile("src/app.ts", `import { useState } from "@angular/core";`)];

    const result = await analyzeSourceUsage(client, "@angular/core", ["useState"], files);

    expect(result.usage).toBe("CANT_DETERMINE");
    expect(result.evidence.some(e => e.includes("@angular/core"))).toBe(true);
  });
});
