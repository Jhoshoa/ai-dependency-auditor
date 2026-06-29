import { scanProject } from "../scanner";
import { createLlmClient } from "../llm";
import { compressAdvisories, analyzeSourceUsage } from "../analysis";
import type { LlmClient } from "../llm/openai-client";
import type { AppConfig, AuditMode } from "../types/config";
import type { Advisory } from "../types/advisory";
import type { Logger } from "../logger";
import type { Report, AnalysisResult, RiskLevel } from "../types/report";
import type { CompressedAdvisory } from "../analysis/compressor";

export interface AgentStep {
  readonly name: string;
  readonly status: "pending" | "running" | "done" | "skipped" | "failed";
  readonly durationMs?: number;
  readonly error?: string;
}

export interface AuditReport {
  readonly report: Report;
  readonly steps: readonly AgentStep[];
  readonly totalDurationMs: number;
}

const mapSeverity = (severity: string): RiskLevel => {
  switch (severity) {
    case "CRITICAL": return "CRITICAL";
    case "HIGH": return "HIGH";
    case "MEDIUM": return "MEDIUM";
    case "LOW": return "LOW";
    default: return "NONE";
  }
};

const createStep = (name: string): AgentStep => ({ name, status: "pending" });

const stepDone = (step: AgentStep, startedAt: number): AgentStep => ({
  ...step,
  status: "done",
  durationMs: Date.now() - startedAt,
});

const stepFailed = (step: AgentStep, startedAt: number, error: string): AgentStep => ({
  ...step,
  status: "failed",
  durationMs: Date.now() - startedAt,
  error,
});

const stepSkipped = (step: AgentStep): AgentStep => ({
  ...step,
  status: "skipped",
});

export const runAudit = async (
  config: AppConfig,
  projectPath: string,
  logger: Logger,
): Promise<AuditReport> => {
  const startTime = Date.now();
  const steps: AgentStep[] = [];

  // Step 1: Scan
  const scanStep = createStep("scan");
  steps.push(scanStep);
  const scanStarted = Date.now();
  let advisories: readonly Advisory[];
  let dependencies: readonly import("../types/dependency").Dependency[];
  let sourcesUsed: readonly string[];
  let projectName: string;

  try {
    logger.info({ event: "agent.step", step: "scan", status: "running" });
    const scanResult = await scanProject({ mode: config.mode, projectPath });
    advisories = scanResult.advisories;
    dependencies = scanResult.dependencies;
    sourcesUsed = scanResult.sourcesUsed;
    projectName = scanResult.project.name || projectPath;
    steps[steps.length - 1] = stepDone(scanStep, scanStarted);
    logger.info({ event: "agent.step", step: "scan", status: "done", advisories: advisories.length, dependencies: dependencies.length });
  } catch (err) {
    steps[steps.length - 1] = stepFailed(scanStep, scanStarted, err instanceof Error ? err.message : String(err));
    throw err;
  }

  if (advisories.length === 0) {
    const elapsed = Date.now() - startTime;
    return buildAuditReport(projectPath, projectName, [], dependencies, sourcesUsed, elapsed, config.mode, config.llm, steps, []);
  }

  // Step 2: Compression (full mode only)
  const compressStep = createStep("compress");
  steps.push(compressStep);
  const compressStarted = Date.now();
  let compressedAdvisories: readonly CompressedAdvisory[];

  if (config.mode === "full") {
    try {
      logger.info({ event: "agent.step", step: "compress", status: "running" });
      let client: LlmClient;
      try {
        client = await createLlmClient(config.llm);
      } catch {
        steps[steps.length - 1] = stepFailed(compressStep, compressStarted, "Failed to create LLM client");
        throw new Error("Failed to create LLM client");
      }

      const { result } = await compressAdvisories(client, advisories);
      compressedAdvisories = result.advisories;
      steps[steps.length - 1] = stepDone(compressStep, compressStarted);
      logger.info({ event: "agent.step", step: "compress", status: "done", input: advisories.length, output: compressedAdvisories.length });
    } catch (err) {
      steps[steps.length - 1] = stepFailed(compressStep, compressStarted, err instanceof Error ? err.message : String(err));
      compressedAdvisories = [];
    }
  } else {
    compressedAdvisories = advisories.map(a => ({
      cveId: a.cveId ?? a.id,
      severity: a.severity,
      vulnerableFunction: a.vulnerableFunctions[0] ?? "general",
      fixVersion: a.fixVersion,
    }));
    steps[steps.length - 1] = stepSkipped(compressStep);
  }

  // Step 3: Source Analysis (full mode only)
  const analysisStep = createStep("source-analysis");
  steps.push(analysisStep);
  const analysisStarted = Date.now();
  const results: AnalysisResult[] = [];

  if (config.mode === "full" && compressedAdvisories.length > 0) {
    try {
      logger.info({ event: "agent.step", step: "source-analysis", status: "running" });
      let client: LlmClient;
      try {
        client = await createLlmClient(config.llm);
      } catch {
        steps[steps.length - 1] = stepFailed(analysisStep, analysisStarted, "Failed to create LLM client");
        throw new Error("Failed to create LLM client");
      }

      const depMap = new Map(dependencies.map(d => [d.name, d]));
      const advisoryMap = new Map(advisories.map(a => [a.cveId ?? a.id, a]));

      for (const ca of compressedAdvisories) {
        const advisory = advisoryMap.get(ca.cveId);
        const dep = depMap.get(advisory?.packageName ?? "");

        try {
          const sourceResult = await analyzeSourceUsage(
            client,
            advisory?.packageName ?? ca.cveId,
            [ca.vulnerableFunction],
            [],
          );

          results.push({
            dependency: {
              name: advisory?.packageName ?? ca.cveId,
              version: dep?.version ?? "unknown",
              type: dep?.type ?? "prod",
            },
            advisory: {
              id: advisory?.id ?? ca.cveId,
              cveId: ca.cveId,
              severity: ca.severity,
              title: advisory?.title ?? "",
              fixVersion: ca.fixVersion,
            },
            usage: sourceResult.usage,
            usageEvidence: [...sourceResult.evidence],
            risk: sourceResult.usage === "NOT_USED" ? "NONE" : mapSeverity(ca.severity),
            confidence: sourceResult.confidence,
          });
        } catch {
          results.push({
            dependency: {
              name: advisory?.packageName ?? ca.cveId,
              version: dep?.version ?? "unknown",
              type: dep?.type ?? "prod",
            },
            advisory: {
              id: advisory?.id ?? ca.cveId,
              cveId: ca.cveId,
              severity: ca.severity,
              title: advisory?.title ?? "",
              fixVersion: ca.fixVersion,
            },
            usage: "CANT_DETERMINE",
            usageEvidence: [],
            risk: mapSeverity(ca.severity),
            confidence: 0,
          });
        }
      }

      steps[steps.length - 1] = stepDone(analysisStep, analysisStarted);
      logger.info({ event: "agent.step", step: "source-analysis", status: "done", count: results.length });
    } catch (err) {
      steps[steps.length - 1] = stepFailed(analysisStep, analysisStarted, err instanceof Error ? err.message : String(err));
    }
  } else {
    for (const ca of compressedAdvisories) {
      const advisory = advisories.find(a => (a.cveId ?? a.id) === ca.cveId);
      const dep = dependencies.find(d => d.name === advisory?.packageName);
      results.push({
        dependency: {
          name: advisory?.packageName ?? ca.cveId,
          version: dep?.version ?? "unknown",
          type: dep?.type ?? "prod",
        },
        advisory: {
          id: advisory?.id ?? ca.cveId,
          cveId: ca.cveId,
          severity: ca.severity,
          title: advisory?.title ?? "",
          fixVersion: ca.fixVersion,
        },
        usage: "CANT_DETERMINE",
        usageEvidence: [],
        risk: mapSeverity(ca.severity),
        confidence: 0,
      });
    }
    steps[steps.length - 1] = stepSkipped(analysisStep);
  }

  const totalDurationMs = Date.now() - startTime;

  return buildAuditReport(
    projectPath, projectName, results, dependencies, sourcesUsed,
    totalDurationMs, config.mode, config.llm, steps, advisories,
  );
};

const buildAuditReport = (
  projectPath: string,
  projectName: string,
  results: readonly AnalysisResult[],
  dependencies: readonly import("../types/dependency").Dependency[],
  sourcesUsed: readonly string[],
  totalDurationMs: number,
  mode: AuditMode,
  llmConfig: import("../types/config").LlmConfig,
  steps: readonly AgentStep[],
  advisories: readonly Advisory[],
): AuditReport => {
  const criticalCount = results.filter(r => r.risk === "CRITICAL").length;
  const highCount = results.filter(r => r.risk === "HIGH").length;
  const mediumCount = results.filter(r => r.risk === "MEDIUM").length;
  const lowCount = results.filter(r => r.risk === "LOW" || r.risk === "NONE").length;
  const falsePositives = results.filter(r => r.usage === "NOT_USED").length;

  const report: Report = {
    summary: {
      totalDependencies: dependencies.length,
      totalAdvisories: advisories.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      falsePositives,
      scanDurationMs: totalDurationMs,
    },
    results: [...results],
    metadata: {
      projectPath,
      llmProvider: llmConfig.provider,
      llmModel: llmConfig.model,
      scannedAt: new Date().toISOString(),
      mode,
      sourcesUsed: [...sourcesUsed],
    },
  };

  return { report, steps, totalDurationMs };
};
