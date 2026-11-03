import type {
  CatalogEntry,
  DataProvider,
  OrbitalRecord,
  ValidationPosition,
} from './types';
import { DataError } from './types';
import type { CacheHit, CacheService } from './cache';

/** Provider slice needed for catalog + element sets (CelesTrak / Space-Track). */
type CatalogSource = Pick<DataProvider, 'getCatalog' | 'getOrbitalData'>;

/** Provider slice needed for validation positions (WTIA / N2YO). */
type PositionSource = Pick<DataProvider, 'getValidationPosition'>;

export interface DataOrchestratorOptions {
  catalogPrimary: CatalogSource;
  catalogFallback: CatalogSource;
  positionPrimary: PositionSource;
  positionFallback: PositionSource;
  cache: CacheService;
}

/**
 * `DataProvider` implementation over the provider set with automatic fallback
 * (CelesTrak -> Space-Track for catalog/element sets, WTIA -> N2YO for
 * validation positions) wrapped in the TTL cache. When every provider fails:
 * stale cache data is served if present (offline mode), otherwise
 * `DATA_ALL_PROVIDERS_FAILED`.
 */
export class DataOrchestrator implements DataProvider {
  constructor(private readonly options: DataOrchestratorOptions) {}

  async getCatalog(): Promise<CatalogEntry[]> {
    return (await this.getCatalogWithMeta()).value;
  }

  /** Catalog with cache metadata (fetchedAt/age) for RF-16 freshness display. */
  async getCatalogWithMeta(): Promise<CacheHit<CatalogEntry[]>> {
    return this.options.cache.getCatalog(() =>
      this.callCatalogSource('catalog', source => source.getCatalog()),
    );
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const hit = await this.options.cache.getOrbitalRecord(noradId, () =>
      this.callCatalogSource(`orbital data for NORAD ${noradId}`, source =>
        source.getOrbitalData(noradId),
      ),
    );
    return hit.value;
  }

  async getValidationPosition(
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition> {
    try {
      return await this.options.positionPrimary.getValidationPosition(
        noradId,
        timestamp,
      );
    } catch (primaryError) {
      try {
        return await this.options.positionFallback.getValidationPosition(
          noradId,
          timestamp,
        );
      } catch {
        throw new DataError(
          'DATA_ALL_PROVIDERS_FAILED',
          `All providers failed to fetch validation position for NORAD ${noradId}.`,
          { cause: primaryError },
        );
      }
    }
  }

  private async callCatalogSource<T>(
    what: string,
    call: (source: CatalogSource) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(this.options.catalogPrimary);
    } catch (primaryError) {
      try {
        return await call(this.options.catalogFallback);
      } catch {
        throw new DataError(
          'DATA_ALL_PROVIDERS_FAILED',
          `All providers failed to fetch ${what}.`,
          { cause: primaryError },
        );
      }
    }
  }
}
