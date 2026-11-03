import type { CatalogEntry, Clock, HttpClient, OrbitalRecord } from '../types';
import { DataError, systemClock } from '../types';
import {
  asObjectArray,
  classifyCatalogGroup,
  parseGpRecord,
  requestJson,
} from './shared';

const GP_BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const SUPGP_STARLINK_URL =
  'https://celestrak.org/NORAD/elements/sup-gp.php?FILE=starlink&FORMAT=json';

/** GP groups downloaded by default (ISS/stations, GPS operacional, weather). */
const DEFAULT_GP_GROUPS: readonly string[] = ['stations', 'gps-ops', 'weather'];

export interface CelesTrakProviderOptions {
  http: HttpClient;
  clock?: Clock;
  /** CelesTrak GROUP names for the GP JSON catalog. */
  gpGroups?: readonly string[];
}

interface SetRow {
  record: OrbitalRecord;
  entry: CatalogEntry;
}

/**
 * CelesTrak provider: GP JSON catalog (`gp.php?GROUP=...&FORMAT=json`) plus the
 * SupGP Starlink set (`sup-gp.php?FILE=starlink&FORMAT=json`). Both return
 * arrays of CCSDS OMM JSON objects; SupGP rows carry extra Starlink metadata.
 *
 * One download feeds both the catalog and the per-satellite lookups: the
 * parsed set is kept in memory and reused while `getCatalog` re-downloads it.
 * `getOrbitalData` falls back to a single-object `CATNR` query when the
 * satellite is outside the cached set.
 */
export class CelesTrakProvider {
  private readonly http: HttpClient;
  private readonly clock: Clock;
  private readonly gpGroups: readonly string[];
  private set = new Map<number, SetRow>();

  constructor(options: CelesTrakProviderOptions) {
    this.http = options.http;
    this.clock = options.clock ?? systemClock;
    this.gpGroups = options.gpGroups ?? DEFAULT_GP_GROUPS;
  }

  /**
   * Downloads the configured set (always fresh: this is the refresh path for
   * RF-09) and returns the derived catalog entries.
   */
  async getCatalog(): Promise<CatalogEntry[]> {
    const fetchedAt = new Date(this.clock.now());
    const set = new Map<number, SetRow>();
    for (const group of this.gpGroups) {
      const raw = await requestJson(
        this.http,
        `${GP_BASE_URL}?GROUP=${group}&FORMAT=json`,
        'CelesTrak GP catalog',
      );
      for (const record of this.parseList(raw, 'celestrak-gp', fetchedAt)) {
        set.set(record.noradId, this.toSetRow(record, group));
      }
    }
    const supRaw = await requestJson(
      this.http,
      SUPGP_STARLINK_URL,
      'CelesTrak SupGP Starlink',
    );
    // SupGP is the richer source for Starlink rows: overwrite GP duplicates.
    for (const record of this.parseList(supRaw, 'celestrak-supgp', fetchedAt)) {
      set.set(record.noradId, this.toSetRow(record, undefined));
    }
    this.set = set;
    return [...set.values()].map(row => row.entry);
  }

  /** Per-satellite lookup served by the downloaded set when possible. */
  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const cached = this.set.get(noradId);
    if (cached) {
      return cached.record;
    }
    const raw = await requestJson(
      this.http,
      `${GP_BASE_URL}?CATNR=${noradId}&FORMAT=json`,
      'CelesTrak GP record',
    );
    const fetchedAt = new Date(this.clock.now());
    const records = this.parseList(raw, 'celestrak-gp', fetchedAt);
    const record = records.find(r => r.noradId === noradId);
    if (!record) {
      throw new DataError(
        'DATA_NOT_FOUND',
        `CelesTrak has no GP data for NORAD ${noradId}.`,
      );
    }
    this.set.set(record.noradId, this.toSetRow(record, undefined));
    return record;
  }

  private parseList(
    raw: unknown,
    source: 'celestrak-gp' | 'celestrak-supgp',
    fetchedAt: Date,
  ): OrbitalRecord[] {
    return asObjectArray(raw, 'CelesTrak response').map(row =>
      parseGpRecord(row, source, fetchedAt),
    );
  }

  private toSetRow(
    record: OrbitalRecord,
    queryGroup: string | undefined,
  ): SetRow {
    return {
      record,
      entry: {
        noradId: record.noradId,
        name: record.name,
        group: classifyCatalogGroup(
          record.noradId,
          record.name,
          record.source,
          queryGroup,
        ),
      },
    };
  }
}
