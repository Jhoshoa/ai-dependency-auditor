export type LlmProvider = "openai" | "anthropic" | "gemini" | "ollama" | "azure" | "groq";

export interface LlmConfig {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly temperature: number;
  readonly maxTokens: number;
}

export interface AuditConfig {
  readonly topK: number;
  readonly cacheTtlHours: number;
  readonly strictMode: boolean;
  readonly format: "json" | "table" | "summary";
}

export interface ProviderDefaults {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyEnv: readonly string[];
  readonly temperature: number;
  readonly maxTokens: number;
}

export interface AppConfig {
  readonly llm: LlmConfig;
  readonly audit: AuditConfig;
  readonly mode: AuditMode;
}

export type AuditMode = "full" | "quick";
