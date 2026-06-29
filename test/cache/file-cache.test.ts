import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { DependencyCache } from "../../src/cache/file-cache";
import type { Advisory } from "../../src/types/advisory";

const makeTempDir = (): string => {
  const dir = resolve(tmpdir(), `dep-audit-cache-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const sampleAdvisory = (overrides?: Partial<Advisory>): Advisory => ({
  id: "GHSA-xxxx-xxxx-xxxx",
  cveId: "CVE-2024-0001",
  source: "osv-dev",
  packageName: "test-pkg",
  affectedVersion: "1.0.0",
  fixVersion: "1.0.1",
  severity: "HIGH",
  title: "Test advisory",
  description: "A test advisory",
  vulnerableFunctions: [],
  references: [],
  publishedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("DependencyCache", () => {
  let cacheDir: string;
  let cache: DependencyCache;

  beforeEach(() => {
    cacheDir = makeTempDir();
    cache = new DependencyCache(cacheDir, 24);
  });

  afterEach(() => {
    try {
      if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
    } catch { /* ignore cleanup failures */ }
  });

  it("returns null for missing key", () => {
    expect(cache.get("nonexistent", "1.0.0")).toBeNull();
  });

  it("stores and retrieves advisories", () => {
    const advisories = [sampleAdvisory()];
    cache.set("test-pkg", "1.0.0", advisories);
    const result = cache.get("test-pkg", "1.0.0");
    expect(result).toEqual(advisories);
  });

  it("returns null for expired entries", () => {
    const expiredCache = new DependencyCache(cacheDir, 0);
    expiredCache.set("test-pkg", "1.0.0", [sampleAdvisory()]);
    expect(expiredCache.get("test-pkg", "1.0.0")).toBeNull();
  });

  it("has returns true for valid key", () => {
    cache.set("test-pkg", "1.0.0", [sampleAdvisory()]);
    expect(cache.has("test-pkg", "1.0.0")).toBe(true);
  });

  it("has returns false for missing key", () => {
    expect(cache.has("missing", "0.0.0")).toBe(false);
  });

  it("has returns false for expired key", () => {
    const expiredCache = new DependencyCache(cacheDir, 0);
    expiredCache.set("test-pkg", "1.0.0", [sampleAdvisory()]);
    expect(expiredCache.has("test-pkg", "1.0.0")).toBe(false);
  });

  it("clear removes all entries", () => {
    cache.set("test-pkg", "1.0.0", [sampleAdvisory()]);
    cache.clear();
    expect(cache.get("test-pkg", "1.0.0")).toBeNull();
  });

  it("persists data to disk between instances", () => {
    cache.set("persist-pkg", "2.0.0", [sampleAdvisory({ id: "GHSA-persist" })]);
    const sameDirCache = new DependencyCache(cacheDir, 24);
    const result = sameDirCache.get("persist-pkg", "2.0.0");
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe("GHSA-persist");
  });

  it("returns stale data via getStale even after TTL expiry", () => {
    const expiredCache = new DependencyCache(cacheDir, 0);
    const advisories = [sampleAdvisory()];
    expiredCache.set("test-pkg", "1.0.0", advisories);
    expect(expiredCache.get("test-pkg", "1.0.0")).toBeNull();
    expect(expiredCache.getStale("test-pkg", "1.0.0")).toEqual(advisories);
  });

  it("getStats reports correct counts", () => {
    expect(cache.getStats().totalEntries).toBe(0);
    cache.set("pkg-a", "1.0.0", [sampleAdvisory()]);
    cache.set("pkg-b", "2.0.0", [sampleAdvisory({ id: "GHSA-b" })]);
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.validEntries).toBe(2);
    expect(stats.expiredEntries).toBe(0);
  });

  it("getStats reports expired entries correctly", () => {
    const expiredCache = new DependencyCache(cacheDir, 0);
    expiredCache.set("expired-pkg", "1.0.0", [sampleAdvisory()]);
    const stats = expiredCache.getStats();
    expect(stats.totalEntries).toBe(1);
    expect(stats.validEntries).toBe(0);
    expect(stats.expiredEntries).toBe(1);
  });

  it("handles corrupt cache file gracefully", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(resolve(cacheDir, "osv-cache.json"), "not valid json{", "utf-8");
    const corruptedCache = new DependencyCache(cacheDir, 24);
    expect(corruptedCache.get("anything", "1.0.0")).toBeNull();
  });

  it("distinguishes entries by package name and version", () => {
    cache.set("pkg", "1.0.0", [sampleAdvisory({ id: "GHSA-v1" })]);
    cache.set("pkg", "2.0.0", [sampleAdvisory({ id: "GHSA-v2" })]);
    expect(cache.get("pkg", "1.0.0")![0].id).toBe("GHSA-v1");
    expect(cache.get("pkg", "2.0.0")![0].id).toBe("GHSA-v2");
  });
});
