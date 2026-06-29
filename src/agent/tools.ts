import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../types/config";
import type { Logger } from "../logger";

export type ToolName =
  | "check-environment"
  | "scan-project"
  | "compress-advisories"
  | "analyze-source"
  | "generate-report";

export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly condition: string;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "check-environment",
    description: "Verifies project structure: package.json, lockfile, src/ directory, and API key availability",
    condition: "Always runs first",
  },
  {
    name: "scan-project",
    description: "Parses package.json, runs npm audit (if lockfile exists), and queries OSV.dev API",
    condition: "Requires package.json",
  },
  {
    name: "compress-advisories",
    description: "Uses LLM to filter irrelevant CVEs and deduplicate, saving tokens and reducing noise",
    condition: "Requires API key + full mode + advisories > 0",
  },
  {
    name: "analyze-source",
    description: "Scans source files for vulnerable function usage using regex + LLM fallback",
    condition: "Requires src/ directory + full mode + compressed advisories > 0",
  },
  {
    name: "generate-report",
    description: "Builds the final AuditReport from accumulated context data",
    condition: "Always runs last",
  },
];

export interface EnvironmentInfo {
  readonly hasPackageJson: boolean;
  readonly hasLockfile: boolean;
  readonly hasSourceDir: boolean;
  readonly hasApiKey: boolean;
}

const LOCKFILE_CANDIDATES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

export const checkEnvironment = (
  projectPath: string,
  config: AppConfig,
): EnvironmentInfo => {
  const hasPackageJson = existsSync(join(projectPath, "package.json"));
  const hasLockfile = LOCKFILE_CANDIDATES.some(candidate =>
    existsSync(join(projectPath, candidate)),
  );
  const hasSourceDir = existsSync(join(projectPath, "src"));
  const hasApiKey = config.llm.apiKey != null || config.llm.provider === "ollama";

  return { hasPackageJson, hasLockfile, hasSourceDir, hasApiKey };
};
