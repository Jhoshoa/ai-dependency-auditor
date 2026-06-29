export interface Dependency {
  readonly name: string;
  readonly version: string;
  readonly type: "prod" | "dev" | "optional" | "peer";
}

export interface LockfileData {
  readonly type: LockfileType;
  readonly path: string;
  readonly packages: Map<string, string>;
}

export type LockfileType = "npm" | "yarn" | "pnpm" | "none";

export interface ParsedProject {
  readonly path: string;
  readonly name: string;
  readonly dependencies: Dependency[];
  readonly lockfile: LockfileData;
}
