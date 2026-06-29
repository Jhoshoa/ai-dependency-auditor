import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scanProject } from "../scanner";
import { createLlmClient } from "../llm";
import { compressAdvisories, analyzeSourceUsage } from "../analysis";
import type { LlmClient } from "../llm/openai-client";
import type { AppConfig, AuditMode } from "../types/config";
import type { Advisory } from "../types/advisory";
import type { Dependency } from "../types/dependency";
import type { Logger } from "../logger";
import type { Report, AnalysisResult, RiskLevel } from "../types/report";
import type { CompressedAdvisory } from "../analysis/compressor";
import type { SourceFileInfo, SourceAnalysisResult } from "../analysis/source-analyzer";
import { checkEnvironment } from "./tools";
import type { EnvironmentInfo } from "./tools";

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
  readonly environment: EnvironmentInfo;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"]);

const collectSourceFiles = (projectPath: string): SourceFileInfo[] => {
  const srcDir = join(projectPath, "src");
  if (!existsSync(srcDir)) return [];

  const files: SourceFileInfo[] = [];
  const walk = (dir: string): void => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath);
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            files.push({ path: fullPath, content });
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  };
  walk(srcDir);
  return files;
};

const mapSeverity = (severity: string): RiskLevel => {
  switch (severity) {
    case "CRITICAL": return "CRITICAL";
    case "HIGH": return "HIGH";
    case "MEDIUM": return "MEDIUM";
    case "LOW": return "LOW";
    default: return "NONE";
  }
};

const startStep = (name: string): { step: AgentStep; startedAt: number } => ({
  step: { name, status: "running" },
  startedAt: Date.now(),
});

const completeStep = (step: AgentStep, startedAt: number): AgentStep => ({
  ...step,
  status: "done",
  durationMs: Date.now() - startedAt,
});

const failStep = (step: AgentStep, startedAt: number, err: unknown): AgentStep => ({
  ...step,
  status: "failed",
  durationMs: Date.now() - startedAt,
  error: err instanceof Error ? err.message : String(err),
});

const skipStep = (name: string): AgentStep => ({
  name,
  status: "skipped",
});

export const runAudit = async (
  config: AppConfig,
  projectPath: string,
  logger: Logger,
): Promise<AuditReport> => {
  const startTime = Date.now();
  const steps: AgentStep[] = [];
  const env = checkEnvironment(projectPath, config);

  logger.info({ event: "agent.evaluate", hasPackageJson: env.hasPackageJson, hasLockfile: env.hasLockfile, hasSourceDir: env.hasSourceDir, hasApiKey: env.hasApiKey });

  if (!env.hasPackageJson) {
    const elapsed = Date.now() - startTime;
    const emptyReport: Report = {
      summary: { totalDependencies: 0, totalAdvisories: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, falsePositives: 0, scanDurationMs: elapsed },
      results: [],
      metadata: {
        projectPath,
        llmProvider: config.llm.provider,
        llmModel: config.llm.model,
        scannedAt: new Date().toISOString(),
        mode: config.mode,
        sourcesUsed: [],
      },
    };
    return { report: emptyReport, steps: [], totalDurationMs: elapsed, environment: env };
  }

  // Step 1: Scan
  const s1 = startStep("scan-project");
  steps.push(s1.step);

  let advisories: readonly Advisory[];
  let dependencies: readonly Dependency[];
  let sourcesUsed: readonly string[];
  let projectName: string;

  try {
    const scanResult = await scanProject({ mode: env.hasLockfile ? config.mode : "quick", projectPath, logger });
    advisories = scanResult.advisories;
    dependencies = scanResult.dependencies;
    sourcesUsed = scanResult.sourcesUsed;
    projectName = scanResult.project.name || projectPath;
    steps[steps.length - 1] = completeStep(s1.step, s1.startedAt);
    logger.info({ event: "agent.scan.complete", advisories: advisories.length, dependencies: dependencies.length, sources: sourcesUsed });
  } catch (err) {
    steps[steps.length - 1] = failStep(s1.step, s1.startedAt, err);
    throw err;
  }

  if (advisories.length === 0) {
    const elapsed = Date.now() - startTime;
    const emptyReport: Report = {
      summary: { totalDependencies: dependencies.length, totalAdvisories: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, falsePositives: 0, scanDurationMs: elapsed },
      results: [],
      metadata: {
        projectPath,
        llmProvider: config.llm.provider,
        llmModel: config.llm.model,
        scannedAt: new Date().toISOString(),
        mode: config.mode,
        sourcesUsed: [...sourcesUsed],
      },
    };
    return { report: emptyReport, steps, totalDurationMs: elapsed, environment: env };
  }

  const canUseLlm = config.mode === "full" && env.hasApiKey;

  // Step 2: Compression
  let compressedAdvisories: readonly CompressedAdvisory[];

  if (canUseLlm) {
    const s2 = startStep("compress-advisories");
    steps.push(s2.step);

    try {
      let client: LlmClient;
      try {
        client = await createLlmClient(config.llm);
      } catch {
        steps[steps.length - 1] = failStep(s2.step, s2.startedAt, new Error("Failed to create LLM client"));
        throw new Error("Failed to create LLM client");
      }

      const { result } = await compressAdvisories(client, advisories);
      compressedAdvisories = result.advisories;
      steps[steps.length - 1] = completeStep(s2.step, s2.startedAt);
      logger.info({ event: "agent.compress.complete", input: advisories.length, output: compressedAdvisories.length });
    } catch (err) {
      steps[steps.length - 1] = failStep(s2.step, s2.startedAt, err);
      compressedAdvisories = [];
    }
  } else {
    compressedAdvisories = advisories.map(a => ({
      cveId: a.cveId ?? a.id,
      severity: a.severity,
      vulnerableFunction: a.vulnerableFunctions[0] ?? "general",
      fixVersion: a.fixVersion,
    }));
    steps.push(skipStep("compress-advisories"));
  }

  // Step 3: Source Analysis
  const results: AnalysisResult[] = [];

  if (canUseLlm && env.hasSourceDir && compressedAdvisories.length > 0) {
    const s3 = startStep("analyze-source");
    steps.push(s3.step);

    try {
      let client: LlmClient;
      try {
        client = await createLlmClient(config.llm);
      } catch {
        steps[steps.length - 1] = failStep(s3.step, s3.startedAt, new Error("Failed to create LLM client"));
        throw new Error("Failed to create LLM client");
      }

      const sourceFiles = collectSourceFiles(projectPath);
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
            sourceFiles,
            dep?.type,
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
            dependency: { name: advisory?.packageName ?? ca.cveId, version: dep?.version ?? "unknown", type: dep?.type ?? "prod" },
            advisory: { id: advisory?.id ?? ca.cveId, cveId: ca.cveId, severity: ca.severity, title: advisory?.title ?? "", fixVersion: ca.fixVersion },
            usage: "CANT_DETERMINE",
            usageEvidence: [],
            risk: mapSeverity(ca.severity),
            confidence: 0,
          });
        }
      }

      steps[steps.length - 1] = completeStep(s3.step, s3.startedAt);
      logger.info({ event: "agent.analysis.complete", count: results.length });
    } catch (err) {
      steps[steps.length - 1] = failStep(s3.step, s3.startedAt, err);
    }
  } else {
    for (const ca of compressedAdvisories) {
      const advisory = advisories.find(a => (a.cveId ?? a.id) === ca.cveId);
      const dep = dependencies.find(d => d.name === advisory?.packageName);
      results.push({
        dependency: { name: advisory?.packageName ?? ca.cveId, version: dep?.version ?? "unknown", type: dep?.type ?? "prod" },
        advisory: { id: advisory?.id ?? ca.cveId, cveId: ca.cveId, severity: ca.severity, title: advisory?.title ?? "", fixVersion: ca.fixVersion },
        usage: "CANT_DETERMINE",
        usageEvidence: [],
        risk: mapSeverity(ca.severity),
        confidence: 0,
      });
    }
    steps.push(skipStep("analyze-source"));
  }

  // Step 4: Generate report
  const totalDurationMs = Date.now() - startTime;
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
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
      scannedAt: new Date().toISOString(),
      mode: config.mode,
      sourcesUsed: [...sourcesUsed],
    },
  };

  return { report, steps, totalDurationMs, environment: env };
};
