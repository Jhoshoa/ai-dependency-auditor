import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import type { Advisory } from "../types/advisory";

interface CacheEntry {
  advisories: Advisory[];
  fetchedAt: string;
  ttlMs: number;
}

interface CacheStore {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface CacheStats {
  totalEntries: number;
  validEntries: number;
  expiredEntries: number;
}

export class DependencyCache {
  private cache: CacheStore;
  private readonly cachePath: string;
  private readonly ttlMs: number;
  private loaded = false;

  constructor(cacheDir?: string, ttlHours?: number) {
    this.cachePath = resolve(
      cacheDir ?? resolve(homedir(), ".dep-audit", "cache"),
      "osv-cache.json",
    );
    this.ttlMs = (ttlHours ?? 24) * 60 * 60 * 1000;
    this.cache = { version: 1, entries: {} };
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.cachePath)) {
        const raw = readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(raw) as CacheStore;
        if (parsed.version === 1 && parsed.entries) {
          this.cache = parsed;
        }
      }
    } catch {
      this.cache = { version: 1, entries: {} };
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch {
      // silently ignore write failures
    }
  }

  private cacheKey(packageName: string, version: string): string {
    return `${packageName}@${version}`;
  }

  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    return age >= entry.ttlMs;
  }

  get(packageName: string, version: string): Advisory[] | null {
    this.load();
    const key = this.cacheKey(packageName, version);
    const entry = this.cache.entries[key];
    if (!entry) return null;
    if (this.isExpired(entry)) return null;
    return entry.advisories;
  }

  getStale(packageName: string, version: string): Advisory[] | null {
    this.load();
    const key = this.cacheKey(packageName, version);
    const entry = this.cache.entries[key];
    if (!entry) return null;
    return entry.advisories;
  }

  set(packageName: string, version: string, advisories: Advisory[]): void {
    this.load();
    const key = this.cacheKey(packageName, version);
    this.cache.entries[key] = {
      advisories,
      fetchedAt: new Date().toISOString(),
      ttlMs: this.ttlMs,
    };
    this.save();
  }

  has(packageName: string, version: string): boolean {
    return this.get(packageName, version) !== null;
  }

  clear(): void {
    this.cache = { version: 1, entries: {} };
    this.save();
  }

  getStats(): CacheStats {
    this.load();
    const entries = Object.values(this.cache.entries);
    const totalEntries = entries.length;
    const expiredEntries = entries.filter((e) => this.isExpired(e)).length;
    return {
      totalEntries,
      validEntries: totalEntries - expiredEntries,
      expiredEntries,
    };
  }
}
