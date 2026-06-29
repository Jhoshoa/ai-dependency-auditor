import type { LlmProvider, AppConfig, LlmConfig, AuditConfig } from "../types/config";
import { readEnvConfig } from "./env";
import { readConfigFile } from "./config-file";
import { getProviderDefault, resolveApiKeyFromEnv } from "./providers";
import { ConfigError } from "../utils/errors";

export interface CliFlags {
  readonly provider: LlmProvider | null;
  readonly model: string | null;
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly temperature: number | null;
  readonly mode: "quick" | "full" | null;
  readonly format: "json" | "table" | "summary" | null;
}

export const resolveConfig = (flags: CliFlags): AppConfig => {
  const env = readEnvConfig();
  const configFile = readConfigFile();

  const provider: LlmProvider = flags.provider ?? env.provider ?? configFile?.llm?.provider ?? "openai";
  const defaults = getProviderDefault(provider);

  const model = flags.model ?? env.model ?? configFile?.llm?.model ?? defaults.model;
  const temperature = flags.temperature ?? env.temperature ?? configFile?.llm?.temperature ?? defaults.temperature;
  const baseUrl = flags.baseUrl ?? env.baseUrl ?? configFile?.llm?.baseUrl ?? defaults.baseUrl;
  const cliOrConfigApiKey = flags.apiKey ?? configFile?.llm?.apiKey ?? null;
  const apiKey = cliOrConfigApiKey ?? resolveApiKeyFromEnv(provider);

  if (!baseUrl && provider === "azure") {
    throw new ConfigError(
      "Azure requires a base URL. Set --llm-base-url, DEP_AUDIT_LLM_BASE_URL, or baseUrl in ~/.dep-audit/config.json",
    );
  }

  if (provider !== "ollama" && !apiKey) {
    const envKeys = defaults.apiKeyEnv;
    throw new ConfigError(
      `No API key found for provider "${provider}". Provide via:\n` +
      `  1. --api-key flag\n` +
      `  2. ${envKeys.join(" or ")} env var\n` +
      `  3. apiKey in ~/.dep-audit/config.json`,
      { provider, requiredEnvVars: envKeys },
    );
  }

  const mode = flags.mode ?? configFile?.audit?.mode ?? "quick";
  const format = flags.format ?? configFile?.audit?.format ?? "table";

  const llm: LlmConfig = {
    provider,
    model,
    baseUrl,
    apiKey,
    temperature,
    maxTokens: configFile?.llm?.maxTokens ?? defaults.maxTokens,
  };

  const audit: AuditConfig = {
    topK: 10,
    cacheTtlHours: configFile?.audit?.cacheTtlHours ?? 24,
    strictMode: configFile?.audit?.strictMode ?? false,
    format,
  };

  return { llm, audit, mode };
};
