import type { LlmConfig } from "../types/config";
import { LlmError, ConfigError } from "../utils/errors";
import type { LlmClient, LlmClientResponse } from "./openai-client";

const TIMEOUT_MS = 30_000;

export const createGeminiClient = async (config: LlmConfig): Promise<LlmClient> => {
  if (!config.apiKey) {
    throw new ConfigError(
      'No API key for Gemini. Set --api-key or DEP_AUDIT_GOOGLE_API_KEY env var.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GoogleGenAI: any;
  try {
    const modPath = "@google-generative-ai" as string;
    GoogleGenAI = (await import(modPath)).GoogleGenerativeAI;
  } catch {
    throw new LlmError(
      "Google Generative AI SDK not installed. Run: npm install @google-generative-ai",
      { provider: "gemini" },
    );
  }

  const genAi = new GoogleGenAI(config.apiKey);

  const model = config.model;

  const callLlm = async (
    systemPrompt: string,
    userPrompt: string,
    responseFormat: "text" | "json" = "text",
  ): Promise<LlmClientResponse> => {
    const startTime = Date.now();

    try {
      const geminiModel = genAi.getGenerativeModel({
        model,
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
          ...(responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
        },
      });

      const result = await geminiModel.generateContent({
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
        ],
      });

      const response = result.response;
      const content = response.text();

      if (responseFormat === "json" && content) {
        try {
          JSON.parse(content);
        } catch {
          throw new LlmError(
            `Invalid JSON response from Gemini. Raw: ${content.slice(0, 200)}`,
            { rawContent: content, model },
          );
        }
      }

      const usageInfo = response.usageMetadata;
      return {
        content,
        model,
        usage: {
          promptTokens: usageInfo?.promptTokenCount ?? 0,
          completionTokens: usageInfo?.candidatesTokenCount ?? 0,
          totalTokens: (usageInfo?.promptTokenCount ?? 0) + (usageInfo?.candidatesTokenCount ?? 0),
        },
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(`Gemini error: ${message}`, {
        provider: "gemini",
        model,
      });
    }
  };

  return { provider: "gemini", model, callLlm };
};
