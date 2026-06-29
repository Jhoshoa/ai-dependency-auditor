import type { LlmProvider } from "../types/config";

interface EnvConfig {
  readonly provider: LlmProvider | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly temperature: number | null;
}

const parseTemperature = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};

export const readEnvConfig = (): EnvConfig => {
  const rawProvider = process.env["DEP_AUDIT_LLM_PROVIDER"];
  const validProviders = ["openai", "anthropic", "gemini", "ollama", "azure", "groq"] as const;
  const provider = rawProvider && validProviders.includes(rawProvider as LlmProvider)
    ? (rawProvider as LlmProvider)
    : null;

  return {
    provider,
    model: process.env["DEP_AUDIT_LLM_MODEL"] ?? null,
    baseUrl: process.env["DEP_AUDIT_LLM_BASE_URL"] ?? null,
    temperature: parseTemperature(process.env["DEP_AUDIT_LLM_TEMPERATURE"]),
  };
};
