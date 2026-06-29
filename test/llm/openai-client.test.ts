import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  OpenAI: class MockOpenAi {
    readonly chat: { completions: { create: typeof mockCreate } };
    constructor(_config: Record<string, unknown>) {
      this.chat = {
        completions: {
          create: mockCreate,
        },
      };
    }
  },
}));

const { createOpenAiClient } = await import("../../src/llm/openai-client");

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  provider: "openai" as const,
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test-key",
  temperature: 0.0,
  maxTokens: 16384,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openai-client", () => {
  it("creates client with provided config", () => {
    const client = createOpenAiClient(makeConfig());
    expect(client.provider).toBe("openai");
    expect(client.model).toBe("gpt-4o-mini");
  });

  it("callLlm returns response content", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Test response" } }],
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = createOpenAiClient(makeConfig());
    const response = await client.callLlm("system", "user");

    expect(response.content).toBe("Test response");
    expect(response.usage.totalTokens).toBe(15);
    expect(typeof response.durationMs).toBe("number");
  });

  it("callLlm parses JSON response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"valid": true}' } }],
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = createOpenAiClient(makeConfig());
    const response = await client.callLlm("system", "user", "json");
    const parsed = JSON.parse(response.content);
    expect(parsed.valid).toBe(true);
  });

  it("callLlm throws LlmError when API errors", async () => {
    mockCreate.mockRejectedValue(new Error("Incorrect API key provided"));

    const client = createOpenAiClient(makeConfig());
    await expect(client.callLlm("system", "user")).rejects.toThrowError(
      expect.objectContaining({ name: "LlmError" }),
    );
  });

  it("callLlm throws LlmError on timeout", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("timeout"), { code: "TIMEOUT" }),
    );

    const client = createOpenAiClient(makeConfig());
    await expect(client.callLlm("system", "user")).rejects.toThrowError(
      expect.objectContaining({ name: "LlmError" }),
    );
  });

  it("throws ConfigError when apiKey is empty for non-ollama", () => {
    expect(() => createOpenAiClient(makeConfig({ apiKey: null }))).toThrowError(
      expect.objectContaining({ name: "ConfigError" }),
    );
  });

  it("allows empty apiKey for ollama", () => {
    const config = makeConfig({ provider: "ollama", apiKey: null, baseUrl: "http://localhost:11434/v1" });
    const client = createOpenAiClient(config);
    expect(client.provider).toBe("ollama");
  });

  it("uses custom model name", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      model: "llama3.2",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });

    const config = makeConfig({ provider: "ollama", model: "llama3.2", apiKey: null, baseUrl: "http://localhost:11434/v1" });
    const client = createOpenAiClient(config);
    const response = await client.callLlm("system", "user");

    expect(response.model).toBe("llama3.2");
    expect(client.model).toBe("llama3.2");
  });
});
