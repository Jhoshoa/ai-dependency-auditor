import type { LlmProvider, ProviderDefaults } from "../types/config";
import { ConfigError } from "../utils/errors";

export const PROVIDER_DEFAULTS: Record<LlmProvider, ProviderDefaults> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnv: ["DEP_AUDIT_OPENAI_API_KEY", "OPENAI_API_KEY"],
    temperature: 0.0,
    maxTokens: 16384,
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-haiku-20240307",
    apiKeyEnv: ["DEP_AUDIT_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
    temperature: 0.0,
    maxTokens: 8192,
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-1.5-flash",
    apiKeyEnv: ["DEP_AUDIT_GOOGLE_API_KEY", "GOOGLE_API_KEY"],
    temperature: 0.0,
    maxTokens: 8192,
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKeyEnv: [],
    temperature: 0.0,
    maxTokens: 8192,
  },
  azure: {
    baseUrl: "",
    model: "gpt-4o-mini",
    apiKeyEnv: ["DEP_AUDIT_AZURE_API_KEY", "AZURE_API_KEY"],
    temperature: 0.0,
    maxTokens: 16384,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama3-70b-8192",
    apiKeyEnv: ["DEP_AUDIT_GROQ_API_KEY", "GROQ_API_KEY"],
    temperature: 0.0,
    maxTokens: 8192,
  },
};

export const PROVIDERS: readonly LlmProvider[] = Object.keys(PROVIDER_DEFAULTS) as LlmProvider[];

export const getProviderDefault = (provider: LlmProvider): ProviderDefaults => {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (!defaults) {
    throw new ConfigError(`Unknown provider: "${provider}". Valid providers: ${PROVIDERS.join(", ")}`);
  }
  return defaults;
};

export const getApiKeyEnvKeys = (provider: LlmProvider): readonly string[] => {
  return PROVIDER_DEFAULTS[provider]?.apiKeyEnv ?? [];
};

export const resolveApiKeyFromEnv = (provider: LlmProvider): string | null => {
  const envKeys = getApiKeyEnvKeys(provider);
  for (const key of envKeys) {
    const value = process.env[key];
    if (value && value.length > 0 && !value.startsWith("sk-...") && value !== "your-api-key-here") {
      return value;
    }
  }
  return null;
};
