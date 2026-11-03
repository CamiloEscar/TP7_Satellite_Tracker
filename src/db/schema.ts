/**
 * op-sqlite schema for the data cache (ARCHITECTURE.md §3).
 * All timestamps are stored as ISO-8601 UTC strings.
 */
export const CREATE_ORBITAL_DATA_TABLE = `
  CREATE TABLE IF NOT EXISTS orbital_data (
    norad_id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    format TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    epoch TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )
`;

// `group` is quoted because it is a SQLite keyword (column name per §3).
export const CREATE_CATALOG_SNAPSHOT_TABLE = `
  CREATE TABLE IF NOT EXISTS catalog_snapshot (
    norad_id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    "group" TEXT NOT NULL,
    object_class TEXT,
    fetched_at TEXT NOT NULL
  )
`;

export const CREATE_CATALOG_SNAPSHOT_NAME_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_name ON catalog_snapshot (name)
`;

/** Idempotent schema creation, in order. */
export const SCHEMA_STATEMENTS: readonly string[] = [
  CREATE_ORBITAL_DATA_TABLE,
  CREATE_CATALOG_SNAPSHOT_TABLE,
  CREATE_CATALOG_SNAPSHOT_NAME_INDEX,
];
