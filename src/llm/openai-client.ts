import { setTimeout as sleep } from "node:timers/promises";
import { OpenAI } from "openai";
import type { LlmConfig } from "../types/config";
import { LlmError, ConfigError } from "../utils/errors";

export interface LlmClientResponse {
  readonly content: string;
  readonly model: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly durationMs: number;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  callLlm(systemPrompt: string, userPrompt: string, responseFormat?: "text" | "json"): Promise<LlmClientResponse>;
}

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

const isTransientError = (err: unknown): boolean => {
  if (err instanceof LlmError) return false;
  const status = (err as { status?: number }).status;
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("rate limit") || message.includes("Rate limit")) return true;
  if (message.includes("overloaded") || message.includes("service unavailable")) return true;
  if (message.includes("Too Many Requests") || message.includes("too many requests")) return true;
  if (message.includes("Internal Server Error") || message.includes("internal error")) return true;
  return false;
};

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  attempt = 0,
): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= MAX_RETRIES || !isTransientError(err)) throw err;

    const delay = Math.min(
      RETRY_BASE_MS * 2 ** attempt + Math.random() * 1000,
      RETRY_MAX_MS,
    );
    await sleep(delay);
    return retryWithBackoff(fn, attempt + 1);
  }
};

export const createOpenAiClient = (config: LlmConfig): LlmClient => {
  if (!config.apiKey && config.provider !== "ollama") {
    throw new ConfigError(
      `No API key for provider "${config.provider}". Set --api-key or ${config.provider === "openai" ? "DEP_AUDIT_OPENAI_API_KEY" : "the appropriate env var"}.`,
    );
  }

  const client = new OpenAI({
    apiKey: config.apiKey ?? "ollama-no-key",
    baseURL: config.baseUrl,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  const model = config.model;

  const callLlm = async (
    systemPrompt: string,
    userPrompt: string,
    responseFormat: "text" | "json" = "text",
  ): Promise<LlmClientResponse> => {
    const startTime = Date.now();

    const execute = async (): Promise<LlmClientResponse> => {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: config.temperature,
        max_completion_tokens: config.maxTokens,
        response_format: responseFormat === "json" ? { type: "json_object" } : undefined,
      });

      const choice = response.choices?.[0];
      const content = choice?.message?.content ?? "";

      if (responseFormat === "json" && content) {
        try {
          JSON.parse(content);
        } catch {
          throw new LlmError(
            `Invalid JSON response from LLM. Raw: ${content.slice(0, 200)}`,
            { rawContent: content, model },
          );
        }
      }

      return {
        content,
        model: response.model ?? model,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        durationMs: Date.now() - startTime,
      };
    };

    try {
      return await retryWithBackoff(execute);
    } catch (err) {
      if (err instanceof LlmError) throw err;

      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("timeout") || message.includes("TIMEOUT") || message.includes("aborted")) {
        throw new LlmError(`Provider timeout after ${TIMEOUT_MS}ms`, {
          provider: config.provider,
          model,
          timeoutMs: TIMEOUT_MS,
        });
      }

      const statusCode = (err as { status?: number }).status;
      throw new LlmError(`Provider error after ${MAX_RETRIES + 1} attempts: ${message}`, {
        provider: config.provider,
        model,
        statusCode,
        retries: MAX_RETRIES,
      });
    }
  };

  return { provider: config.provider, model, callLlm };
};
