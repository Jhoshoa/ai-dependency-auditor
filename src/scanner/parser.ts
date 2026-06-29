import { join, resolve } from "node:path";
import { readJsonFile, detectLockfile, detectMultipleLockfiles, fileExists } from "../utils/file";
import { ScannerError } from "../utils/errors";
import type { Dependency, ParsedProject, LockfileData } from "../types/dependency";
import type { Logger } from "../logger";

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

interface NpmLockfile {
  readonly packages?: Record<string, { version?: string; dev?: boolean; optional?: boolean; peer?: boolean }>;
}

const parseVersion = (version: string): string => {
  return version.replace(/^[\^~>=<]/, "");
};

const extractDepsFromPackageJson = (pkg: PackageJson): Dependency[] => {
  const deps: Dependency[] = [];

  const addDeps = (
    depsMap: Record<string, string> | undefined,
    type: Dependency["type"],
  ): void => {
    if (!depsMap) return;
    for (const [name, version] of Object.entries(depsMap)) {
      deps.push({ name, version: parseVersion(version), type });
    }
  };

  addDeps(pkg.dependencies, "prod");
  addDeps(pkg.devDependencies, "dev");
  addDeps(pkg.optionalDependencies, "optional");
  addDeps(pkg.peerDependencies, "peer");

  return deps;
};

export const parseProject = async (
  projectPath: string,
  logger?: Logger,
): Promise<ParsedProject> => {
  const resolvedPath = resolve(projectPath);
  const packageJsonPath = join(resolvedPath, "package.json");

  if (!fileExists(packageJsonPath)) {
    throw new ScannerError(
      "NO_PACKAGE_JSON",
      `No package.json found at: ${resolvedPath}`,
      { path: resolvedPath },
    );
  }

  const pkg = await readJsonFile<PackageJson>(packageJsonPath);
  const dependencies = extractDepsFromPackageJson(pkg);
  const lockfileInfo = detectLockfile(resolvedPath);

  const multipleLockfiles = detectMultipleLockfiles(resolvedPath);
  if (multipleLockfiles.length > 1) {
    const types = multipleLockfiles.map((l) => l.type).join(", ");
    logger?.warn({
      event: "multiple-lockfiles",
      types,
      primary: lockfileInfo.type,
      message: `Multiple lockfiles detected (${types}). Using ${lockfileInfo.type} as primary.`,
    });
  }

  let lockfileData: LockfileData;

  if (lockfileInfo.type === "npm" && lockfileInfo.path) {
    try {
      const lockPkg = await readJsonFile<NpmLockfile>(lockfileInfo.path);
      const packages = new Map<string, string>();

      if (lockPkg.packages) {
        for (const [pkgName, pkgData] of Object.entries(lockPkg.packages)) {
          if (pkgName === "") continue;
          const cleanName = pkgName.replace(/^node_modules\//, "");
          if (pkgData.version) {
            packages.set(cleanName, pkgData.version);
          }
        }
      }

      lockfileData = {
        type: "npm",
        path: lockfileInfo.path,
        packages,
      };
    } catch (err) {
      logger?.warn({
        event: "lockfile-corrupt",
        path: lockfileInfo.path,
        message: "Lockfile appears corrupt. Falling back to package.json only.",
        error: err instanceof Error ? err.message : String(err),
      });
      lockfileData = {
        type: "none",
        path: lockfileInfo.path,
        packages: new Map(),
      };
    }
  } else {
    lockfileData = {
      type: lockfileInfo.type,
      path: lockfileInfo.path ?? "",
      packages: new Map(),
    };
  }

  return {
    path: resolvedPath,
    name: pkg.name ?? "unknown",
    dependencies,
    lockfile: lockfileData,
  };
};

export const getDependenciesWithLockfileVersions = (project: ParsedProject): Dependency[] => {
  if (project.lockfile.type === "none" || project.lockfile.packages.size === 0) {
    return project.dependencies;
  }

  return project.dependencies.map((dep) => {
    const lockedVersion = project.lockfile.packages.get(dep.name);
    if (lockedVersion) {
      return { ...dep, version: lockedVersion };
    }
    return dep;
  });
};
