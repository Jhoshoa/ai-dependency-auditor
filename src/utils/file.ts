import { accessSync, constants, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ScannerError } from "./errors";

export const fileExists = (path: string): boolean => {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const readJsonFile = async <T>(path: string): Promise<T> => {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    throw new ScannerError(
      "INVALID_JSON",
      `Failed to parse JSON file: ${path}`,
      { originalError: err instanceof Error ? err.message : String(err) },
    );
  }
};

export const readJsonFileSync = <T>(path: string): T => {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    throw new ScannerError(
      "INVALID_JSON",
      `Failed to parse JSON file: ${path}`,
      { originalError: err instanceof Error ? err.message : String(err) },
    );
  }
};

export const detectLockfile = (projectPath: string): { type: "npm" | "yarn" | "pnpm" | "none"; path: string | null } => {
  const candidates = [
    { type: "npm" as const, file: "package-lock.json" },
    { type: "yarn" as const, file: "yarn.lock" },
    { type: "pnpm" as const, file: "pnpm-lock.yaml" },
  ];

  for (const candidate of candidates) {
    const fullPath = `${projectPath}/${candidate.file}`;
    if (fileExists(fullPath)) {
      return { type: candidate.type, path: fullPath };
    }
  }

  return { type: "none", path: null };
};

export const detectMultipleLockfiles = (projectPath: string): Array<{ type: "npm" | "yarn" | "pnpm"; path: string }> => {
  const found: Array<{ type: "npm" | "yarn" | "pnpm"; path: string }> = [];
  const candidates = [
    { type: "npm" as const, file: "package-lock.json" },
    { type: "yarn" as const, file: "yarn.lock" },
    { type: "pnpm" as const, file: "pnpm-lock.yaml" },
  ];
  for (const candidate of candidates) {
    const fullPath = `${projectPath}/${candidate.file}`;
    if (fileExists(fullPath)) {
      found.push({ type: candidate.type, path: fullPath });
    }
  }
  return found;
};
