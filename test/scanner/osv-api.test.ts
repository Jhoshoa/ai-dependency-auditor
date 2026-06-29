import { describe, it, expect, vi } from "vitest";
import { queryOsv } from "../../src/scanner/osv-api";

describe("osv-api", () => {
  it("returns empty bundle for empty deps", async () => {
    const result = await queryOsv([]);
    expect(result.advisories).toHaveLength(0);
    expect(result.source).toBe("osv-dev");
  });

  it("handles network errors gracefully", async () => {
    const result = await queryOsv([{ name: "nonexistent-package-12345", version: "1.0.0" }]);
    expect(result.advisories).toBeDefined();
    expect(result.source).toBe("osv-dev");
  });

  it("returns advisories for known vulnerable packages", async () => {
    const result = await queryOsv([{ name: "lodash", version: "4.17.20" }]);
    expect(result.advisories.length).toBeGreaterThan(0);
    const hasLodashAdvisory = result.advisories.some((a) => a.packageName === "lodash");
    expect(hasLodashAdvisory).toBe(true);
  }, 15000);

  it("maps advisory fields correctly from OSV response", async () => {
    const result = await queryOsv([{ name: "lodash", version: "4.17.20" }]);
    const first = result.advisories[0];
    expect(first).toBeDefined();
    expect(first.id).toMatch(/^GHSA-/);
    expect(first.source).toBe("osv-dev");
    expect(first.packageName).toBe("lodash");
    expect(first.severity).toMatch(/^(NONE|LOW|MEDIUM|HIGH|CRITICAL)$/);
    expect(first.title).toBeTruthy();
  }, 15000);
});
