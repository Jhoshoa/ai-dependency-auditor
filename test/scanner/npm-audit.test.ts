import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecSync = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

const { runNpmAudit } = await import("../../src/scanner/npm-audit");

beforeEach(() => {
  vi.clearAllMocks();
});

const makeVuln = (overrides: Record<string, unknown> = {}) => ({
  name: "lodash",
  severity: "high",
  range: ">=4.17.20 <4.17.21",
  title: "Prototype Pollution",
  via: [],
  fixAvailable: { name: "lodash", version: "4.17.21" },
  ...overrides,
});

describe("npm-audit", () => {
  it("returns empty bundle when no vulnerabilities", () => {
    mockExecSync.mockReturnValue(JSON.stringify({}));

    const result = runNpmAudit("/some/project");
    expect(result.advisories).toHaveLength(0);
    expect(result.source).toBe("npm-audit");
  });

  it("parses advisories from npm audit output", () => {
    const vuln = makeVuln();
    mockExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: { lodash: vuln } }),
    );

    const result = runNpmAudit("/some/project");
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0].packageName).toBe("lodash");
    expect(result.advisories[0].severity).toBe("HIGH");
    expect(result.advisories[0].fixVersion).toBe("4.17.21");
  });

  it("extracts CVE ID from via array (object with cve field)", () => {
    const vuln = makeVuln({
      via: [
        { title: "Prototype Pollution", cve: "CVE-2021-23337" },
      ],
    });
    mockExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: { lodash: vuln } }),
    );

    const result = runNpmAudit("/some/project");
    expect(result.advisories[0].cveId).toBe("CVE-2021-23337");
  });

  it("extracts CVE ID from via array (title starting with CVE-)", () => {
    const vuln = makeVuln({
      via: [
        "CVE-2021-23337",
        { title: "GHSA-xxx" },
      ],
    });
    mockExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: { lodash: vuln } }),
    );

    const result = runNpmAudit("/some/project");
    expect(result.advisories[0].cveId).toBe("CVE-2021-23337");
  });

  it("returns null CVE when via has no CVE references", () => {
    const vuln = makeVuln({
      via: [
        { title: "Prototype Pollution" },
      ],
    });
    mockExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: { lodash: vuln } }),
    );

    const result = runNpmAudit("/some/project");
    expect(result.advisories[0].cveId).toBeNull();
  });

  it("maps severity correctly (critical, high, moderate, low)", () => {
    const vulns = {
      pkg1: makeVuln({ name: "pkg1", severity: "critical" }),
      pkg2: makeVuln({ name: "pkg2", severity: "high" }),
      pkg3: makeVuln({ name: "pkg3", severity: "moderate" }),
      pkg4: makeVuln({ name: "pkg4", severity: "low" }),
    };
    mockExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: vulns }),
    );

    const result = runNpmAudit("/some/project");
    const byName = Object.fromEntries(
      result.advisories.map((a) => [a.packageName, a.severity]),
    );
    expect(byName.pkg1).toBe("CRITICAL");
    expect(byName.pkg2).toBe("HIGH");
    expect(byName.pkg3).toBe("MEDIUM");
    expect(byName.pkg4).toBe("LOW");
  });

  it("throws ScannerError when npm audit command fails", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("npm ERR! code ENOENT");
      (err as any).code = "ENOENT";
      throw err;
    });

    expect(() => runNpmAudit("/invalid/path")).toThrowError(
      expect.objectContaining({ code: "AUDIT_FAILED" }),
    );
  });

  it("throws ScannerError on malformed JSON output", () => {
    mockExecSync.mockReturnValue("not valid json");

    expect(() => runNpmAudit("/some/project")).toThrowError(
      expect.objectContaining({ code: "AUDIT_PARSE_ERROR" }),
    );
  });
});
