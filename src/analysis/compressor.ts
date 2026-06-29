import { type Advisory, type Severity } from "../types/advisory";
import type { LlmClient } from "../llm/openai-client";
import { getSystemPrompt } from "../llm/prompts";

export interface CompressedAdvisory {
  readonly cveId: string;
  readonly severity: Severity;
  readonly vulnerableFunction: string;
  readonly fixVersion: string | null;
}

export interface CompressionResult {
  readonly advisories: readonly CompressedAdvisory[];
  readonly removedCount: number;
  readonly totalInput: number;
}

export interface CompressionStats {
  readonly inputCount: number;
  readonly outputCount: number;
  readonly removedCount: number;
  readonly durationMs: number;
}

const VALID_SEVERITIES = new Set<Severity>(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]);

const validateSeverity = (s: string): s is Severity =>
  VALID_SEVERITIES.has(s as Severity);

const formatAdvisoriesForPrompt = (advisories: readonly Advisory[]): string =>
  advisories.map((a, i) =>
    `[${i + 1}] CVE: ${a.cveId ?? "N/A"} | Package: ${a.packageName} | Severity: ${a.severity} | Title: ${a.title} | Description: ${a.description} | Affected: ${a.affectedVersion} | Fix: ${a.fixVersion ?? "none"} | Functions: ${a.vulnerableFunctions.join(", ") || "none"}`
  ).join("\n");

const parseCompressedResponse = (
  content: string,
  totalInput: number,
): { advisories: CompressedAdvisory[]; removedCount: number } => {
  const trimmed = content.trim();
  if (trimmed === "NONE") {
    return { advisories: [], removedCount: totalInput };
  }

  let parsed: Array<Record<string, unknown>>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { advisories: [], removedCount: totalInput };
  }

  if (!Array.isArray(parsed)) {
    return { advisories: [], removedCount: totalInput };
  }

  const advisories: CompressedAdvisory[] = [];
  for (const item of parsed) {
    const severity = typeof item.severity === "string" && validateSeverity(item.severity)
      ? item.severity as Severity
      : "NONE";
    advisories.push({
      cveId: String(item.cve_id ?? item.cveId ?? ""),
      severity,
      vulnerableFunction: String(item.vulnerable_function ?? item.vulnerableFunction ?? "general"),
      fixVersion: item.fix_version != null ? String(item.fix_version) : null,
    });
  }

  return { advisories, removedCount: totalInput - advisories.length };
};

const fallbackResult = (advisories: readonly Advisory[]): CompressionResult => ({
  advisories: advisories.map(a => ({
    cveId: a.cveId ?? a.id,
    severity: a.severity,
    vulnerableFunction: a.vulnerableFunctions[0] ?? "general",
    fixVersion: a.fixVersion,
  })),
  removedCount: 0,
  totalInput: advisories.length,
});

export const compressAdvisories = async (
  client: LlmClient,
  advisories: readonly Advisory[],
): Promise<{ result: CompressionResult; stats: CompressionStats }> => {
  const startTime = Date.now();
  const totalInput = advisories.length;

  if (totalInput === 0) {
    return {
      result: { advisories: [], removedCount: 0, totalInput: 0 },
      stats: { inputCount: 0, outputCount: 0, removedCount: 0, durationMs: 0 },
    };
  }

  const userPrompt = formatAdvisoriesForPrompt(advisories);

  let content: string;
  try {
    const response = await client.callLlm(getSystemPrompt("compression"), userPrompt, "json");
    content = response.content;
  } catch {
    return {
      result: fallbackResult(advisories),
      stats: { inputCount: totalInput, outputCount: totalInput, removedCount: 0, durationMs: Date.now() - startTime },
    };
  }

  const { advisories: compressed, removedCount } = parseCompressedResponse(content, totalInput);
  const outputCount = compressed.length;

  return {
    result: { advisories: compressed, removedCount, totalInput },
    stats: { inputCount: totalInput, outputCount, removedCount, durationMs: Date.now() - startTime },
  };
};
