import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "./config";
import { writeDefaultConfig } from "./config/config-file";
import type { CliFlags } from "./config";
import { runAudit } from "./agent";
import { formatOutput } from "./output";
import { logger, TraceRecorder } from "./logger/trace";
import { AuditError, ConfigError, LlmError } from "./utils/errors";
import { fileExists } from "./utils/file";

const __dirname = dirname(fileURLToPath(import.meta.url));

const getPkgVersion = (): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const program = new Command();

program
  .name("dep-audit")
  .description("AI-powered dependency vulnerability auditor")
  .version(getPkgVersion());

program
  .command("check")
  .description("Scan a project for dependency vulnerabilities")
  .argument("[path]", "Project path", ".")
  .option("-m, --mode <mode>", 'Audit mode: "full" (with LLM) or "quick" (no LLM)', "quick")
  .option("-f, --format <format>", 'Output format: "json" | "table" | "summary"', "table")
  .option("--llm-provider <provider>", "LLM provider (openai, anthropic, gemini, ollama, azure, groq)")
  .option("--llm-model <model>", "LLM model name")
  .option("--api-key <key>", "LLM API key")
  .option("--llm-base-url <url>", "LLM API base URL")
  .option("--temperature <value>", "LLM temperature (0.0 = deterministic)", Number)
  .option("--json", "Shortcut for --format=json")
  .action(async (path: string, options: Record<string, unknown>) => {
    try {
      const projectPath = path || ".";

      if (!fileExists(projectPath)) {
        console.error(`Path not found: ${projectPath}`);
        process.exit(1);
      }

      const configPath = writeDefaultConfig();
      if (configPath) {
        logger.info({ event: "config.created", path: configPath });
      }

      const flags: CliFlags = {
        provider: (options.llmProvider as import("./types/config").LlmProvider) ?? null,
        model: (options.llmModel as string) ?? null,
        apiKey: (options.apiKey as string) ?? null,
        baseUrl: (options.llmBaseUrl as string) ?? null,
        temperature: options.temperature != null ? Number(options.temperature) : null,
        mode: (options.mode as "quick" | "full") ?? null,
        format: options.json ? "json" : ((options.format as "json" | "table" | "summary") ?? null),
      };

      const config = resolveConfig(flags);

      const auditReport = await runAudit(config, projectPath, logger);

      const traceRecorder = new TraceRecorder();
      if (traceRecorder.isLangSmithEnabled) {
        logger.info({ event: "langsmith.enabled" });
      }
      const tracePath = traceRecorder.record(auditReport, config);

      logger.info({
        event: "audit.complete",
        dependencies: auditReport.report.summary.totalDependencies,
        advisories: auditReport.report.summary.totalAdvisories,
        falsePositives: auditReport.report.summary.falsePositives,
        sources: auditReport.report.metadata.sourcesUsed,
        durationMs: auditReport.totalDurationMs,
        provider: config.llm.provider,
        model: config.llm.model,
        steps: auditReport.steps.length,
        trace: tracePath,
      });

      const output = formatOutput(auditReport, config.audit.format);
      console.log(output);

      const hasRealIssues = auditReport.report.results.some(
        (r) => (r.risk === "CRITICAL" || r.risk === "HIGH") && r.usage !== "NOT_USED",
      );
      process.exit(hasRealIssues ? 1 : 0);
    } catch (err) {
      if (err instanceof ConfigError) {
        logger.error({ event: "config.error", message: err.message });
      } else if (err instanceof LlmError) {
        logger.error({ event: "llm.error", message: err.message, code: err.code });
      } else if (err instanceof AuditError) {
        logger.error({ event: "audit.error", code: err.code, message: err.message });
      } else {
        logger.error({
          event: "unexpected.error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
