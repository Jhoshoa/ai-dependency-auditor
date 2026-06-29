import type { AuditReport } from "../agent/orchestrator";
import { formatJson } from "./json";
import { formatTable } from "./table";
import { formatSummary } from "./summary";

export type OutputFormat = "json" | "table" | "summary";

export const formatOutput = (auditReport: AuditReport, format: OutputFormat): string => {
  switch (format) {
    case "json":
      return formatJson(auditReport);
    case "table":
      return formatTable(auditReport);
    case "summary":
      return formatSummary(auditReport);
  }
};

export { formatJson } from "./json";
export { formatTable } from "./table";
export { formatSummary } from "./summary";
