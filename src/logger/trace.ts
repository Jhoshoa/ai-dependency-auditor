import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createLogger, sanitize } from "./index";
import type { Logger } from "./index";
import type { AuditReport } from "../agent/orchestrator";
import type { AppConfig } from "../types/config";

const DEFAULT_TRACES_DIR = resolve(homedir(), ".dep-audit", "traces");

const sanitizeConfig = (config: AppConfig): Record<string, unknown> => ({
  llm: sanitize({
    provider: config.llm.provider,
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
  }),
  audit: { ...config.audit },
  mode: config.mode,
});

export class TraceRecorder {
  private readonly tracesDir: string;
  private readonly logger: Logger;

  constructor(tracesDir?: string) {
    this.tracesDir = tracesDir ?? DEFAULT_TRACES_DIR;
    this.logger = createLogger("trace", "info");
  }

  get isLangSmithEnabled(): boolean {
    return (
      process.env["LANGSMITH_TRACING_V2"] === "true" &&
      !!process.env["LANGCHAIN_API_KEY"]
    );
  }

  record(auditReport: AuditReport, config: AppConfig): string | null {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shortId = Math.random().toString(36).slice(2, 8);
    const fileName = `audit-${timestamp}-${shortId}.json`;
    const filePath = resolve(this.tracesDir, fileName);

    const traceData = {
      version: 1,
      recordedAt: new Date().toISOString(),
      config: sanitizeConfig(config),
      langSmithEnabled: this.isLangSmithEnabled,
      environment: { ...auditReport.environment },
      report: sanitizeReport(auditReport.report as unknown as Record<string, unknown>),
      steps: auditReport.steps.map((s) => ({ ...s })),
      totalDurationMs: auditReport.totalDurationMs,
    };

    try {
      if (!existsSync(this.tracesDir)) {
        mkdirSync(this.tracesDir, { recursive: true });
      }
      writeFileSync(filePath, JSON.stringify(traceData, null, 2), "utf-8");
      this.logger.info({ event: "trace.saved", path: filePath });
      return filePath;
    } catch (err) {
      this.logger.warn({
        event: "trace.save.failed",
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

const sanitizeReport = (report: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = sanitize(report);
  if (sanitized.metadata && typeof sanitized.metadata === "object") {
    const meta = sanitized.metadata as Record<string, unknown>;
    sanitized.metadata = sanitize(meta);
  }
  return sanitized;
};

export const logger: Logger = createLogger("dep-audit", "info");
