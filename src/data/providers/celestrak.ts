import type { CatalogEntry, Clock, HttpClient, OrbitalRecord } from '../types';
import { DataError, systemClock } from '../types';
import {
  asObjectArray,
  classifyCatalogGroup,
  parseGpRecord,
  requestJson,
} from './shared';

const GP_BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';
// SupGP lives under /NORAD/elements/supplemental/ (verified live 2026-11-03;
// the /NORAD/elements/sup-gp.php path 404s). CelesTrak serves each SupGP FILE
// at most once per 2 h and answers repeats with a 403 text notice, so the GP
// GROUP=starlink set is the always-available base and SupGP only enriches it.
const SUPGP_STARLINK_URL =
  'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=JSON';

/** GP groups downloaded by default (ISS/stations, Starlink, GPS, weather). */
const DEFAULT_GP_GROUPS: readonly string[] = [
  'stations',
  'starlink',
  'gps-ops',
  'weather',
];

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
 * SupGP can return several elements for one object (multiple epochs or
 * sources); keep only the newest per NORAD ID.
 */
function newestPerNoradId(records: OrbitalRecord[]): OrbitalRecord[] {
  const newest = new Map<number, OrbitalRecord>();
  for (const record of records) {
    const kept = newest.get(record.noradId);
    if (!kept || record.epoch > kept.epoch) {
      newest.set(record.noradId, record);
    }
  }
  return [...newest.values()];
}

/**
 * CelesTrak provider: GP JSON catalog (`gp.php?GROUP=...&FORMAT=json`) plus the
 * SupGP Starlink set (`supplemental/sup-gp.php?FILE=starlink&FORMAT=JSON`). Both
 * return arrays of CCSDS OMM JSON objects; SupGP rows carry extra Starlink
 * metadata.
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
   * RF-09) and returns the derived catalog entries. A single failing source
   * is tolerated: only when every source fails does this throw.
   */
  async getCatalog(): Promise<CatalogEntry[]> {
    const fetchedAt = new Date(this.clock.now());
    const set = new Map<number, SetRow>();
    let succeeded = 0;
    let firstFailure: unknown;

    const loadSource = async (
      fetchRows: () => Promise<unknown>,
      source: 'celestrak-gp' | 'celestrak-supgp',
      queryGroup: string | undefined,
    ): Promise<void> => {
      try {
        const records = this.parseList(await fetchRows(), source, fetchedAt);
        // SupGP may carry several elements per object: keep the newest.
        const rows =
          source === 'celestrak-supgp' ? newestPerNoradId(records) : records;
        for (const record of rows) {
          set.set(record.noradId, this.toSetRow(record, queryGroup));
        }
        succeeded += 1;
      } catch (e) {
        firstFailure ??= e;
      }
    };

    for (const group of this.gpGroups) {
      await loadSource(
        () =>
          requestJson(
            this.http,
            `${GP_BASE_URL}?GROUP=${group}&FORMAT=json`,
            'CelesTrak GP catalog',
          ),
        'celestrak-gp',
        group,
      );
    }
    // SupGP is the richer source for Starlink rows: overwrite GP duplicates.
    await loadSource(
      () =>
        requestJson(this.http, SUPGP_STARLINK_URL, 'CelesTrak SupGP Starlink'),
      'celestrak-supgp',
      undefined,
    );

    if (succeeded === 0) {
      throw firstFailure instanceof DataError
        ? firstFailure
        : new DataError(
            'DATA_NETWORK',
            'CelesTrak: every catalog source failed.',
            { cause: firstFailure },
          );
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
