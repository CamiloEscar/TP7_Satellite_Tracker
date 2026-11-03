import type { CacheStore, CatalogSnapshot, OrbitalRecord } from './types';

/**
 * In-memory `CacheStore`. Used by tests and as a composition fallback when no
 * persistent store is available.
 */
export class MemoryCacheStore implements CacheStore {
  private snapshot: CatalogSnapshot | null = null;
  private readonly records = new Map<number, OrbitalRecord>();

  async getCatalogSnapshot(): Promise<CatalogSnapshot | null> {
    return this.snapshot;
  }

  async setCatalogSnapshot(snapshot: CatalogSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async getOrbitalRecord(noradId: number): Promise<OrbitalRecord | null> {
    return this.records.get(noradId) ?? null;
  }

  async setOrbitalRecord(record: OrbitalRecord): Promise<void> {
    this.records.set(record.noradId, record);
  }
}
