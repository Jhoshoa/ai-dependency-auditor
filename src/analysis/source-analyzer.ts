import type { LlmClient } from "../llm/openai-client";
import { getSystemPrompt } from "../llm/prompts";
import type { UsageStatus } from "../types/report";

export interface SourceFileInfo {
  readonly path: string;
  readonly content: string;
}

export interface SourceAnalysisResult {
  readonly usage: UsageStatus;
  readonly evidence: readonly string[];
  readonly confidence: number;
}

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findImportUsages = (content: string, packageName: string): string[] => {
  const evidence: string[] = [];
  const escaped = escapeRegex(packageName);

  const patterns = [
    { label: "import", regex: new RegExp(`import\\s+(?:\\{[^}]*\\}|\\*\\s+as\\s+\\w+|\\w+)\\s+from\\s+['"]${escaped}['"]`, "g") },
    { label: "require", regex: new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*require\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`, "g") },
    { label: "dynamic import", regex: new RegExp(`import\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`, "g") },
  ];

  for (const { label, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      evidence.push(`Found ${label}: ${match[0].trim()}`);
    }
  }

  return evidence;
};

const findFunctionCallUsages = (content: string, functionNames: readonly string[]): string[] => {
  const evidence: string[] = [];
  for (const fn of functionNames) {
    const escaped = escapeRegex(fn);
    const methodRegex = new RegExp(`\\.\\s*${escaped}\\s*\\(`, "g");
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(content)) !== null) {
      const start = Math.max(0, match.index - 30);
      const snippet = content.slice(start, match.index + match[0].length + 30).replace(/\n/g, "\\n");
      evidence.push(`Called method: ...${snippet}...`);
    }
    const standaloneRegex = new RegExp(`(?<=\\W|^)${escaped}\\s*\\(`, "g");
    while ((match = standaloneRegex.exec(content)) !== null) {
      const start = Math.max(0, match.index - 30);
      const snippet = content.slice(start, match.index + match[0].length + 30).replace(/\n/g, "\\n");
      evidence.push(`Called function: ...${snippet}...`);
    }
  }
  return evidence;
};

export const analyzeSourceUsage = async (
  client: LlmClient,
  packageName: string,
  functionNames: readonly string[],
  sourceFiles: readonly SourceFileInfo[],
  depType?: "prod" | "dev" | "optional" | "peer",
): Promise<SourceAnalysisResult> => {
  const allEvidence: string[] = [];

  for (const file of sourceFiles) {
    for (const e of findImportUsages(file.content, packageName)) {
      allEvidence.push(`[${file.path}] ${e}`);
    }
    for (const e of findFunctionCallUsages(file.content, functionNames)) {
      allEvidence.push(`[${file.path}] ${e}`);
    }
  }

  if (allEvidence.length === 0) {
    if (depType === "prod" || depType === "dev") {
      return { usage: "CANT_DETERMINE", evidence: [`Package is a direct ${depType} dependency but not imported in src/ files`], confidence: 0.5 };
    }
    return { usage: "NOT_USED", evidence: [], confidence: 1 };
  }

  const hasCalls = allEvidence.some(e => e.includes("Called"));
  if (hasCalls) {
    return { usage: "USED", evidence: allEvidence, confidence: 1 };
  }

  const isGenericAdvisory = functionNames.every(fn => fn === "general" || fn === "unknown" || fn === "vulnerable_function");
  if (isGenericAdvisory) {
    return { usage: "USED", evidence: allEvidence, confidence: 0.7 };
  }

  const fileContext = sourceFiles
    .map(f => `--- ${f.path} ---\n${f.content.slice(0, 500)}`)
    .join("\n\n")
    .slice(0, 4000);

  const systemPrompt = getSystemPrompt("sourceAnalysis")
    .replace("{functionName}", functionNames.join(", "))
    .replace("{packageName}", packageName);

  try {
    const response = await client.callLlm(systemPrompt, fileContext, "json");
    const parsed = JSON.parse(response.content);
    return {
      usage: parsed.usage === "USED" || parsed.usage === "NOT_USED" ? parsed.usage : "CANT_DETERMINE",
      evidence: [...allEvidence, ...(Array.isArray(parsed.evidence) ? parsed.evidence : [])],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return { usage: "CANT_DETERMINE", evidence: allEvidence, confidence: 0.5 };
  }
};
