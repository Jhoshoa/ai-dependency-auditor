import { parseProject, getDependenciesWithLockfileVersions } from "./parser";
import { runNpmAudit } from "./npm-audit";
import { queryOsv } from "./osv-api";
import { ScannerError } from "../utils/errors";
import { fileExists } from "../utils/file";
import type { ParsedProject, Dependency } from "../types/dependency";
import type { Advisory, AdvisoryBundle } from "../types/advisory";
import type { AuditMode } from "../types/config";

interface ScanOptions {
  readonly mode: AuditMode;
  readonly projectPath: string;
}

interface ScanResult {
  readonly project: ParsedProject;
  readonly dependencies: readonly Dependency[];
  readonly advisories: readonly Advisory[];
  readonly sourcesUsed: readonly string[];
  readonly scanDurationMs: number;
}

export const scanProject = async (options: ScanOptions): Promise<ScanResult> => {
  const startTime = Date.now();
  const { projectPath, mode } = options;

  const project = await parseProject(projectPath);
  const deps = getDependenciesWithLockfileVersions(project);

  if (deps.length === 0) {
    return {
      project,
      dependencies: [],
      advisories: [],
      sourcesUsed: [],
      scanDurationMs: Date.now() - startTime,
    };
  }

  const bundles: AdvisoryBundle[] = [];
  const sourcesUsed: string[] = [];

  const hasLockfile = project.lockfile.type !== "none";

  if (hasLockfile) {
    try {
      const npmBundle = runNpmAudit(projectPath);
      bundles.push(npmBundle);
      sourcesUsed.push("npm-audit");
    } catch (err) {
      if (err instanceof ScannerError) {
        sourcesUsed.push("npm-audit:failed");
      }
    }
  }

  if (mode === "full") {
    try {
      const osvBundle = await queryOsv(deps);
      if (osvBundle.advisories.length > 0) {
        bundles.push(osvBundle);
        sourcesUsed.push("osv-dev");
      }
    } catch {
      sourcesUsed.push("osv-dev:failed");
    }
  }

  const advisoryMap = new Map<string, Advisory>();

  for (const bundle of bundles) {
    for (const advisory of bundle.advisories) {
      const key = `${advisory.packageName}-${advisory.id}`;
      if (!advisoryMap.has(key)) {
        advisoryMap.set(key, advisory);
      }
    }
  }

  return {
    project,
    dependencies: deps,
    advisories: Array.from(advisoryMap.values()),
    sourcesUsed,
    scanDurationMs: Date.now() - startTime,
  };
};
