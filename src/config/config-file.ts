import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { readJsonFileSync } from "../utils/file";
import { ConfigError } from "../utils/errors";

const ConfigFileSchema = z.object({
  llm: z.object({
    provider: z.enum(["openai", "anthropic", "gemini", "ollama", "azure", "groq"]).optional(),
    model: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }).optional(),
  audit: z.object({
    mode: z.enum(["quick", "full"]).optional(),
    format: z.enum(["json", "table", "summary"]).optional(),
    cacheTtlHours: z.number().int().positive().optional(),
    strictMode: z.boolean().optional(),
  }).optional(),
});

type ConfigFileData = z.infer<typeof ConfigFileSchema>;

export const getConfigFilePath = (): string => {
  const configDir = resolve(homedir(), ".dep-audit");
  return resolve(configDir, "config.json");
};

export const ensureConfigDir = (): void => {
  const configDir = dirname(getConfigFilePath());
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
};

export const writeDefaultConfig = (): string => {
  ensureConfigDir();
  const configPath = getConfigFilePath();
  if (existsSync(configPath)) return configPath;

  const defaults: ConfigFileData = {
    llm: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "YOUR_API_KEY_HERE",
      temperature: 0.0,
      maxTokens: 16384,
    },
    audit: {
      mode: "quick",
      format: "table",
      cacheTtlHours: 24,
      strictMode: false,
    },
  };

  writeFileSync(configPath, JSON.stringify(defaults, null, 2), "utf-8");
  return configPath;
};

export const readConfigFile = (): ConfigFileData | null => {
  const configPath = getConfigFilePath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readJsonFileSync<Record<string, unknown>>(configPath);
    const parsed = ConfigFileSchema.parse(raw);
    return parsed;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ConfigError(`Invalid config file at ${configPath}: ${issues}`);
    }
    throw new ConfigError(`Failed to read config file at ${configPath}`);
  }
};
