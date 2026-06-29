import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../../src/scanner/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const FIXTURES = resolve(__dirname, "../fixtures");

describe("scanner: integration", () => {
  it("scans a project with dependencies in quick mode", async () => {
    const result = await scanProject({
      mode: "quick",
      projectPath: resolve(FIXTURES, "vulnerable-project"),
    });
    expect(result.project.name).toBe("vulnerable-project");
    expect(result.dependencies.length).toBeGreaterThan(0);
    expect(result.scanDurationMs).toBeGreaterThan(0);
  });

  it("scans a project with no dependencies", async () => {
    const result = await scanProject({
      mode: "quick",
      projectPath: resolve(FIXTURES, "no-deps"),
    });
    expect(result.dependencies).toHaveLength(0);
    expect(result.advisories).toHaveLength(0);
  });

  it("scans a project with private dependencies", async () => {
    const result = await scanProject({
      mode: "quick",
      projectPath: resolve(FIXTURES, "private-deps"),
    });
    expect(result.dependencies.length).toBeGreaterThan(0);
    const hasPrivateDep = result.dependencies.some(
      (d) => d.name === "@company/internal-lib",
    );
    expect(hasPrivateDep).toBe(true);
  });

  it("returns sources used", async () => {
    const result = await scanProject({
      mode: "quick",
      projectPath: resolve(FIXTURES, "vulnerable-project"),
    });
    expect(result.sourcesUsed.length).toBeGreaterThan(0);
  });

  it("handles non-existent path", async () => {
    await expect(
      scanProject({ mode: "quick", projectPath: "/nonexistent/path" }),
    ).rejects.toThrow();
  });
});
