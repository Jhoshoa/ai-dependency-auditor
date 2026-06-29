export class AuditError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuditError";
  }
}

export class ScannerError extends AuditError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "ScannerError";
  }
}

export class ConfigError extends AuditError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG_ERROR", message, details);
    this.name = "ConfigError";
  }
}

export class NetworkError extends AuditError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    details?: Record<string, unknown>,
  ) {
    super("NETWORK_ERROR", message, { ...details, statusCode });
    this.name = "NetworkError";
  }
}

export class LlmError extends AuditError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("LLM_ERROR", message, details);
    this.name = "LlmError";
  }
}
