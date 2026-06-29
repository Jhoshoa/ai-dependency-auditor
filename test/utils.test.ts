import { describe, it, expect } from "vitest";
import { fileExists, detectLockfile, readJsonFileSync } from "../src/utils/file";
import { resolve } from "node:path";

const FIXTURES = resolve(__dirname, "fixtures");

describe("utility: file", () => {
  it("fileExists returns true for existing file", () => {
    expect(fileExists(resolve(FIXTURES, "vulnerable-project", "package.json"))).toBe(true);
  });

  it("fileExists returns false for non-existing file", () => {
    expect(fileExists(resolve(FIXTURES, "nonexistent.json"))).toBe(false);
  });

  it("detectLockfile returns 'none' for project without lockfile", () => {
    const result = detectLockfile(resolve(FIXTURES, "no-deps"));
    expect(result.type).toBe("none");
    expect(result.path).toBeNull();
  });

  it("readJsonFileSync parses valid JSON", () => {
    const data = readJsonFileSync<{ name: string }>(
      resolve(FIXTURES, "vulnerable-project", "package.json"),
    );
    expect(data.name).toBe("vulnerable-project");
  });

  it("readJsonFileSync throws on invalid JSON", () => {
    expect(() => readJsonFileSync("nonexistent.json")).toThrow();
  });
});
