const PREFIX = "[dep-audit]";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogPayload = string | Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /apikey/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /authorization/i,
  /bearer/i,
  /auth/i,
  /private[_-]?key/i,
];

const hasSensitiveKey = (key: string): boolean =>
  SENSITIVE_PATTERNS.some((p) => p.test(key));

export const sanitizeString = (value: string): string => {
  let result = value;
  const patterns = [
    /(api[_-]?key\s*[:=]\s*['"]?)([^'"\s&]+)/gi,
    /(token\s*[:=]\s*['"]?)([^'"\s&]+)/gi,
    /(secret\s*[:=]\s*['"]?)([^'"\s&]+)/gi,
    /(password\s*[:=]\s*['"]?)([^'"\s&]+)/gi,
    /(bearer\s+)([a-zA-Z0-9._-]+)/gi,
    /(authorization:\s*)(basic\s+[a-zA-Z0-9=]+)/gi,
    /(authorization:\s*)(bearer\s+[a-zA-Z0-9._-]+)/gi,
  ];
  for (const pattern of patterns) {
    result = result.replace(pattern, "$1***REDACTED***");
  }
  result = result.replace(
    /sk-[a-zA-Z0-9]{20,}/g,
    "sk-***REDACTED***",
  );
  return result;
};

export const sanitizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const sensitiveParams = ["api_key", "apikey", "key", "token", "secret", "password", "auth"];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "***REDACTED***");
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

export const sanitize = (data: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (hasSensitiveKey(key)) {
      result[key] = "***REDACTED***";
    } else if (typeof value === "string") {
      let cleaned: string = value;
      cleaned = cleaned.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***REDACTED***");
      cleaned = cleaned.replace(/bearer\s+[a-zA-Z0-9._-]+/gi, "bearer ***REDACTED***");
      result[key] = cleaned;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object"
          ? sanitize(item as Record<string, unknown>)
          : item,
      );
    } else if (value !== null && typeof value === "object") {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
};

export interface Logger {
  info: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  warn: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  error: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  debug: (msgOrObj: LogPayload, ...args: unknown[]) => void;
  child: (name: string) => Logger;
}

const log = (
  level: LogLevel,
  minLevel: LogLevel,
  prefix: string,
  msgOrObj: LogPayload,
  ...args: unknown[]
): void => {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  const timestamp = new Date().toISOString();
  const fullPrefix = `${timestamp} ${prefix} [${level.toUpperCase()}]`;

  if (typeof msgOrObj === "string") {
    let message = msgOrObj;
    message = sanitizeString(message);
    if (args.length > 0) {
      const sanitizedArgs = args.map((arg) => {
        if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
          return sanitize(arg as Record<string, unknown>);
        }
        if (typeof arg === "string") return sanitizeString(arg);
        return arg;
      });
      message += " " + JSON.stringify(sanitizedArgs);
    }
    process.stderr.write(`${fullPrefix} ${message}\n`);
  } else {
    process.stderr.write(`${fullPrefix} ${JSON.stringify(sanitize(msgOrObj))}\n`);
  }
};

export const createLogger = (name: string, minLevel: LogLevel = "info"): Logger => {
  const prefix = `${PREFIX}:${name}`;
  const logFn = (level: LogLevel, msgOrObj: LogPayload, ...args: unknown[]) =>
    log(level, minLevel, prefix, msgOrObj, ...args);

  return {
    info: (msgOrObj: LogPayload, ...args: unknown[]) => logFn("info", msgOrObj, ...args),
    warn: (msgOrObj: LogPayload, ...args: unknown[]) => logFn("warn", msgOrObj, ...args),
    error: (msgOrObj: LogPayload, ...args: unknown[]) => logFn("error", msgOrObj, ...args),
    debug: (msgOrObj: LogPayload, ...args: unknown[]) => logFn("debug", msgOrObj, ...args),
    child: (childName: string) => createLogger(`${name}:${childName}`, minLevel),
  };
};
