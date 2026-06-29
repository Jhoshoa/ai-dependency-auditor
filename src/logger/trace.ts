import { createLogger, type Logger } from "./index";

interface TraceEntry extends Record<string, unknown> {
  readonly event: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
  readonly durationMs?: number;
}

const logger = createLogger("dep-audit");

export const trace = (event: string, data: Record<string, unknown>, durationMs?: number): void => {
  const entry: TraceEntry = { event, timestamp: new Date().toISOString(), data, durationMs };
  logger.info(entry);
};

export { logger };
