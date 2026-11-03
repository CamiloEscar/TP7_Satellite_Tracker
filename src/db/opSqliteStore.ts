import { open } from '@op-engineering/op-sqlite';
import type { DB, Scalar, SQLBatchTuple } from '@op-engineering/op-sqlite';
import type {
  CacheStore,
  CatalogEntry,
  CatalogGroup,
  CatalogSnapshot,
  OrbitalRecord,
  OrbitalSource,
  TlePayload,
} from '../data/types';
import type { OmmJson } from '../orbital/types';
import { SCHEMA_STATEMENTS } from './schema';

export const DEFAULT_DB_NAME = 'tp7-cache.db';

type Row = Record<string, Scalar>;

/**
 * Thin `CacheStore` adapter over op-sqlite (ARCHITECTURE.md §3). SQL and row
 * mapping only: TTL and staleness logic live in `data/cache.ts`.
 */
export class OpSqliteStore implements CacheStore {
  private readonly db: DB;

  constructor(db?: DB) {
    this.db = db ?? open({ name: DEFAULT_DB_NAME });
    for (const statement of SCHEMA_STATEMENTS) {
      this.db.executeSync(statement);
    }
  }

  async getCatalogSnapshot(): Promise<CatalogSnapshot | null> {
    const { rows } = await this.db.execute(
      'SELECT norad_id, name, "group", fetched_at FROM catalog_snapshot',
    );
    if (rows.length === 0) {
      return null;
    }
    return {
      entries: rows.map(
        (row): CatalogEntry => ({
          noradId: Number(row.norad_id),
          name: String(row.name),
          group: String(row.group) as CatalogGroup,
        }),
      ),
      fetchedAt: new Date(String(rows[0].fetched_at)),
    };
  }

  async setCatalogSnapshot(snapshot: CatalogSnapshot): Promise<void> {
    const fetchedAt = snapshot.fetchedAt.toISOString();
    const statements: SQLBatchTuple[] = [['DELETE FROM catalog_snapshot']];
    for (const entry of snapshot.entries) {
      statements.push([
        'INSERT INTO catalog_snapshot (norad_id, name, "group", object_class, fetched_at) VALUES (?, ?, ?, ?, ?)',
        [entry.noradId, entry.name, entry.group, null, fetchedAt],
      ]);
    }
    await this.db.executeBatch(statements);
  }

  async getOrbitalRecord(noradId: number): Promise<OrbitalRecord | null> {
    const { rows } = await this.db.execute(
      'SELECT * FROM orbital_data WHERE norad_id = ?',
      [noradId],
    );
    const row = rows[0];
    return row ? this.toRecord(row) : null;
  }

  async setOrbitalRecord(record: OrbitalRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO orbital_data (norad_id, name, source, format, payload_json, epoch, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(norad_id) DO UPDATE SET
         name = excluded.name,
         source = excluded.source,
         format = excluded.format,
         payload_json = excluded.payload_json,
         epoch = excluded.epoch,
         fetched_at = excluded.fetched_at`,
      [
        record.noradId,
        record.name,
        record.source,
        record.format,
        JSON.stringify(record.payload),
        record.epoch.toISOString(),
        record.fetchedAt.toISOString(),
      ],
    );
  }

  private toRecord(row: Row): OrbitalRecord {
    const base = {
      noradId: Number(row.norad_id),
      name: String(row.name),
      source: String(row.source) as OrbitalSource,
      epoch: new Date(String(row.epoch)),
      fetchedAt: new Date(String(row.fetched_at)),
    };
    const payload = JSON.parse(String(row.payload_json));
    return row.format === 'tle'
      ? { ...base, format: 'tle', payload: payload as TlePayload }
      : { ...base, format: 'omm', payload: payload as OmmJson };
  }
}
