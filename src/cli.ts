import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "./scanner";
import { resolveConfig } from "./config";
import type { CliFlags } from "./config";
import { logger } from "./logger/trace";
import { AuditError, ConfigError, LlmError } from "./utils/errors";
import { fileExists } from "./utils/file";
import type { Dependency } from "./types/dependency";
import type { Advisory } from "./types/advisory";

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

      logger.info({ event: "scan.start", path: projectPath, mode: config.mode, provider: config.llm.provider });

      const result = await scanProject({
        mode: config.mode,
        projectPath,
      });

      logger.info({
        event: "scan.complete",
        dependencies: result.dependencies.length,
        advisories: result.advisories.length,
        sources: result.sourcesUsed,
        durationMs: result.scanDurationMs,
        provider: config.llm.provider,
        model: config.llm.model,
      });

      if (config.audit.format === "json") {
        printJson(result);
      } else if (config.audit.format === "table") {
        await printTable(result);
      } else {
        printSummary(result);
      }

      const hasRealIssues = result.advisories.some(
        (a) => a.severity === "CRITICAL" || a.severity === "HIGH",
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

interface ScanResult {
  readonly project: { readonly name: string; readonly path: string };
  readonly dependencies: readonly Dependency[];
  readonly advisories: readonly Advisory[];
  readonly sourcesUsed: readonly string[];
  readonly scanDurationMs: number;
}

const printJson = (result: ScanResult): void => {
  const output = {
    project: { name: result.project.name, path: result.project.path },
    dependencies: result.dependencies.map((d) => ({
      name: d.name,
      version: d.version,
      type: d.type,
    })),
    advisories: result.advisories.map((a) => ({
      packageName: a.packageName,
      cveId: a.cveId,
      severity: a.severity,
      title: a.title,
      fixVersion: a.fixVersion,
      id: a.id,
    })),
    sourcesUsed: [...result.sourcesUsed],
    scanDurationMs: result.scanDurationMs,
  };
  console.log(JSON.stringify(output, null, 2));
};

const printTable = async (result: ScanResult): Promise<void> => {
  const pc = await import("picocolors");

  console.log(`\n${pc.default.bold("AI Dependency Auditor")}`);
  console.log(`${pc.default.dim("Project:")} ${result.project.name || result.project.path}`);
  console.log(`${pc.default.dim("Dependencies:")} ${result.dependencies.length}`);
  console.log(`${pc.default.dim("Sources:")} ${[...result.sourcesUsed].join(", ") || "none"}`);
  console.log(`${pc.default.dim("Duration:")} ${result.scanDurationMs}ms\n`);

  if (result.advisories.length === 0) {
    console.log(pc.default.green("✓ No vulnerabilities found.\n"));
    return;
  }

  const critical = result.advisories.filter((a) => a.severity === "CRITICAL").length;
  const high = result.advisories.filter((a) => a.severity === "HIGH").length;
  const medium = result.advisories.filter((a) => a.severity === "MEDIUM").length;
  const low = result.advisories.filter((a) => a.severity === "LOW" || a.severity === "NONE").length;

  console.log(
    `${pc.default.red(`CRITICAL: ${critical}`)} | ${pc.default.red(`HIGH: ${high}`)} | ${pc.default.yellow(`MEDIUM: ${medium}`)} | ${pc.default.dim(`LOW: ${low}`)}\n`,
  );

  const depMap = new Map(result.dependencies.map((d) => [d.name, d.version]));

  for (const adv of result.advisories) {
    const color = adv.severity === "CRITICAL" || adv.severity === "HIGH"
      ? pc.default.red
      : adv.severity === "MEDIUM"
        ? pc.default.yellow
        : pc.default.dim;

    console.log(
      `${color(`${adv.severity.padEnd(8)}`)} ${pc.default.bold(adv.packageName)}@${depMap.get(adv.packageName) || "?"}`,
    );
    console.log(`  ${pc.default.dim(adv.title)}`);
    if (adv.cveId) console.log(`  ${pc.default.dim(`CVE: ${adv.cveId}`)}`);
    if (adv.fixVersion) console.log(`  ${pc.default.green(`Fix: upgrade to ${adv.fixVersion}`)}`);
    console.log("");
  }
};

const printSummary = (result: ScanResult): void => {
  const critical = result.advisories.filter((a) => a.severity === "CRITICAL").length;
  const high = result.advisories.filter((a) => a.severity === "HIGH").length;
  const total = result.advisories.length;

  console.log(
    `\n[dep-audit] Scan complete: ${result.dependencies.length} deps, ${total} advisories (${critical} critical, ${high} high)`,
  );
  console.log(
    "[dep-audit] Run with --format=table for details or --json for machine output.\n",
  );
};
