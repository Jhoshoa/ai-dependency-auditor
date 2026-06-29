import type { LlmConfig } from "../types/config";
import { LlmError, ConfigError } from "../utils/errors";
import type { LlmClient, LlmClientResponse } from "./openai-client";

const TIMEOUT_MS = 30_000;

export const createAnthropicClient = async (config: LlmConfig): Promise<LlmClient> => {
  if (!config.apiKey) {
    throw new ConfigError(
      'No API key for Anthropic. Set --api-key or DEP_AUDIT_ANTHROPIC_API_KEY env var.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any;
  try {
    const modPath = "@anthropic-ai/sdk" as string;
    Anthropic = (await import(modPath)).default;
  } catch {
    throw new LlmError(
      "Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk",
      { provider: "anthropic" },
    );
  }

  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: TIMEOUT_MS,
  });

  const model = config.model;

  const callLlm = async (
    systemPrompt: string,
    userPrompt: string,
    responseFormat: "text" | "json" = "text",
  ): Promise<LlmClientResponse> => {
    const startTime = Date.now();

    try {
      const response = await client.messages.create({
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      });

      const content = response.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n");

      if (responseFormat === "json" && content) {
        try {
          JSON.parse(content);
        } catch {
          throw new LlmError(
            `Invalid JSON response from Anthropic. Raw: ${content.slice(0, 200)}`,
            { rawContent: content, model },
          );
        }
      }

      return {
        content,
        model: response.model,
        usage: {
          promptTokens: response.usage?.input_tokens ?? 0,
          completionTokens: response.usage?.output_tokens ?? 0,
          totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
        },
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(`Anthropic error: ${message}`, {
        provider: "anthropic",
        model,
      });
    }
  };

  return { provider: "anthropic", model, callLlm };
};
