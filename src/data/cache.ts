import type { CacheStore, CatalogEntry, Clock, OrbitalRecord } from './types';
import { systemClock } from './types';

/** Result of a cache lookup, with the freshness metadata consumed by RF-16. */
export interface CacheHit<T> {
  value: T;
  /** UTC instant of the download that produced the value. */
  fetchedAt: Date;
  /** Element-set epoch of the cached orbital data (null for catalog snapshots). */
  epoch: Date | null;
  /** True when a expired entry was served because the fetch failed (offline mode). */
  stale: boolean;
  /** Age of the data in milliseconds (now - fetchedAt). */
  ageMs: number;
}

const MS_PER_HOUR = 3600000;
const MIN_TTL_HOURS = 12;
const MAX_TTL_HOURS = 24;
export const DEFAULT_TTL_HOURS = MAX_TTL_HOURS;

export interface CacheServiceOptions {
  /** TTL in hours, clamped to the 12-24 h range (RF-09). Default: 24 h. */
  ttlHours?: number;
  clock?: Clock;
}

/**
 * TTL cache over a `CacheStore`. Behavior:
 * - fresh hit: served without touching the network (works offline);
 * - expired: fetched from the provider and stored;
 * - expired + fetch failure: the stale entry is served, flagged `stale`, with
 *   its age (operar sin conectividad).
 */
export class CacheService {
  private readonly ttlMs: number;
  private readonly clock: Clock;

  constructor(
    private readonly store: CacheStore,
    options: CacheServiceOptions = {},
  ) {
    const ttlHours = options.ttlHours ?? DEFAULT_TTL_HOURS;
    if (ttlHours < MIN_TTL_HOURS || ttlHours > MAX_TTL_HOURS) {
      throw new RangeError(
        `TTL must be between ${MIN_TTL_HOURS} h and ${MAX_TTL_HOURS} h (got ${ttlHours} h).`,
      );
    }
    this.ttlMs = ttlHours * MS_PER_HOUR;
    this.clock = options.clock ?? systemClock;
  }

  async getCatalog(
    fetchCatalog: () => Promise<CatalogEntry[]>,
  ): Promise<CacheHit<CatalogEntry[]>> {
    const cached = await this.store.getCatalogSnapshot();
    if (cached && this.isFresh(cached.fetchedAt)) {
      return this.buildHit(cached.entries, cached.fetchedAt, null, false);
    }
    try {
      const entries = await fetchCatalog();
      const fetchedAt = new Date(this.clock.now());
      await this.store.setCatalogSnapshot({ entries, fetchedAt });
      return this.buildHit(entries, fetchedAt, null, false);
    } catch (e) {
      if (cached) {
        return this.buildHit(cached.entries, cached.fetchedAt, null, true);
      }
      throw e;
    }
  }

  async getOrbitalRecord(
    noradId: number,
    fetchRecord: () => Promise<OrbitalRecord>,
  ): Promise<CacheHit<OrbitalRecord>> {
    const cached = await this.store.getOrbitalRecord(noradId);
    if (cached && this.isFresh(cached.fetchedAt)) {
      return this.buildHit(cached, cached.fetchedAt, cached.epoch, false);
    }
    try {
      const record = await fetchRecord();
      await this.store.setOrbitalRecord(record);
      return this.buildHit(record, record.fetchedAt, record.epoch, false);
    } catch (e) {
      if (cached) {
        return this.buildHit(cached, cached.fetchedAt, cached.epoch, true);
      }
      throw e;
    }
  }

  private isFresh(fetchedAt: Date): boolean {
    return this.clock.now() - fetchedAt.getTime() < this.ttlMs;
  }

  private buildHit<T>(
    value: T,
    fetchedAt: Date,
    epoch: Date | null,
    stale: boolean,
  ): CacheHit<T> {
    return {
      value,
      fetchedAt,
      epoch,
      stale,
      ageMs: Math.max(0, this.clock.now() - fetchedAt.getTime()),
    };
  }
}
