const PREFIX = "[dep-audit]";

export type LogPayload = string | Record<string, unknown>;

export interface Logger {
  info: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  warn: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  error: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  debug: (msgOrObj: LogPayload, ...args: unknown[]) => void;
}

const sanitize = (data: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (key.toLowerCase().includes("key") || key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
      sanitized[key] = "***REDACTED***";
    }
  }
  return sanitized;
};

const log = (level: string, msgOrObj: LogPayload, ...args: unknown[]): void => {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${PREFIX} [${level}]`;
  if (typeof msgOrObj === "string") {
    process.stderr.write(`${prefix} ${msgOrObj}${args.length > 0 ? " " + JSON.stringify(args) : ""}\n`);
  } else {
    process.stderr.write(`${prefix} ${JSON.stringify(sanitize(msgOrObj))}\n`);
  }
};

export const createLogger = (_name: string): Logger => ({
  info: (msgOrObj: LogPayload, ...args: unknown[]) => log("INFO", msgOrObj, ...args),
  warn: (msgOrObj: LogPayload, ...args: unknown[]) => log("WARN", msgOrObj, ...args),
  error: (msgOrObj: LogPayload, ...args: unknown[]) => log("ERROR", msgOrObj, ...args),
  debug: (msgOrObj: LogPayload, ...args: unknown[]) => log("DEBUG", msgOrObj, ...args),
});
