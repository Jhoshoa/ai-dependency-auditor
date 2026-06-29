import type { LlmConfig, LlmProvider } from "../types/config";
import { ConfigError } from "../utils/errors";
import { createOpenAiClient } from "./openai-client";
import type { LlmClient } from "./openai-client";

const OPENAI_COMPATIBLE: readonly LlmProvider[] = ["openai", "ollama", "azure", "groq"];

export const createLlmClient = async (config: LlmConfig): Promise<LlmClient> => {
  if (OPENAI_COMPATIBLE.includes(config.provider)) {
    return createOpenAiClient(config);
  }

  switch (config.provider) {
    case "anthropic": {
      const { createAnthropicClient } = await import("./anthropic-client");
      return createAnthropicClient(config);
    }
    case "gemini": {
      const { createGeminiClient } = await import("./gemini-client");
      return createGeminiClient(config);
    }
    default:
      throw new ConfigError(
        `Unsupported LLM provider: "${config.provider}". Valid providers: openai, anthropic, gemini, ollama, azure, groq`,
      );
  }
};

export type { LlmClient } from "./openai-client";
export type { LlmClientResponse } from "./openai-client";
