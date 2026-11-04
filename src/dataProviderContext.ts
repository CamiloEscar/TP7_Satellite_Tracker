import { createContext, useContext } from 'react';
import type { CacheHit, CatalogEntry, DataProvider } from './data';

/**
 * `DataProvider` plus the catalog freshness metadata exposed by
 * `DataOrchestrator.getCatalogWithMeta()` (RF-16). The orchestrator satisfies
 * it structurally; tests inject plain fakes.
 */
export type AppDataProvider = DataProvider & {
  getCatalogWithMeta(): Promise<CacheHit<CatalogEntry[]>>;
};

export const DataProviderContext = createContext<AppDataProvider | null>(null);

export function useDataProvider(): AppDataProvider {
  const provider = useContext(DataProviderContext);
  if (!provider) {
    throw new Error(
      'useDataProvider must be used within DataProviderContext.Provider',
    );
  }
  return provider;
}
