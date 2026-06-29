import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject, getDependenciesWithLockfileVersions } from "../../src/scanner/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const FIXTURES = resolve(__dirname, "../fixtures");

describe("parser", () => {
  it("parses a project with dependencies", async () => {
    const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
    expect(project.name).toBe("vulnerable-project");
    expect(project.dependencies.length).toBeGreaterThan(0);
  });

  it("extracts production dependencies correctly", async () => {
    const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
    const prodDeps = project.dependencies.filter((d) => d.type === "prod");
    expect(prodDeps.some((d) => d.name === "lodash")).toBe(true);
    expect(prodDeps.some((d) => d.name === "axios")).toBe(true);
    expect(prodDeps.some((d) => d.name === "express")).toBe(true);
  });

  it("extracts dev dependencies correctly", async () => {
    const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
    const devDeps = project.dependencies.filter((d) => d.type === "dev");
    expect(devDeps.some((d) => d.name === "mocha")).toBe(true);
  });

  it("handles project with no dependencies", async () => {
    const project = await parseProject(resolve(FIXTURES, "no-deps"));
    expect(project.dependencies.length).toBe(0);
  });

  it("strips semver range from versions", async () => {
    const project = await parseProject(resolve(FIXTURES, "vulnerable-project"));
    const lodash = project.dependencies.find((d) => d.name === "lodash");
    expect(lodash?.version).toBe("4.17.20");
  });

  it("throws for non-existent path", async () => {
    await expect(parseProject("/nonexistent/path")).rejects.toThrow();
  });

  it("returns original deps when no lockfile", () => {
    const project = {
      name: "test",
      path: "/test",
      dependencies: [{ name: "lodash", version: "4.17.20", type: "prod" as const }],
      lockfile: { type: "none" as const, path: "", packages: new Map() },
    };
    const deps = getDependenciesWithLockfileVersions(project);
    expect(deps).toEqual(project.dependencies);
  });
});
