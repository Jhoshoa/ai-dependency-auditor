import { parseProject, getDependenciesWithLockfileVersions } from "./parser";
import { runNpmAudit } from "./npm-audit";
import { queryOsv } from "./osv-api";
import { DependencyCache } from "../cache";
import { ScannerError } from "../utils/errors";
import { fileExists } from "../utils/file";
import type { Logger } from "../logger";
import type { ParsedProject, Dependency } from "../types/dependency";
import type { Advisory, AdvisoryBundle } from "../types/advisory";
import type { AuditMode } from "../types/config";

interface ScanOptions {
  readonly mode: AuditMode;
  readonly projectPath: string;
  readonly offline?: boolean;
  readonly cacheTtlHours?: number;
  readonly logger?: Logger;
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
  const { projectPath, mode, offline = false, cacheTtlHours, logger } = options;

  const project = await parseProject(projectPath, logger);
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
    const needsCache = offline || cacheTtlHours === undefined || cacheTtlHours > 0;
    const cache = needsCache ? new DependencyCache(undefined, cacheTtlHours) : undefined;
    try {
      const osvBundle = await queryOsv(deps, { offline, cache });
      if (osvBundle.advisories.length > 0) {
        bundles.push(osvBundle);
        sourcesUsed.push(offline ? "osv-dev:cache" : "osv-dev");
      } else if (!offline) {
        sourcesUsed.push("osv-dev:no-results");
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
