import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DataErrorCode } from '../data';
import { DataError } from '../data';
import { useDataProvider } from '../dataProviderContext';
import { getObserver } from '../observer';
import { getSelectedNoradId } from '../selection';
import {
  ISS_NORAD_ID,
  errorTableToCsv,
  errorTableToMarkdown,
  runValidation,
  sourcesFromProvider,
} from '../validation';
import type { ErrorTable, ValidationMode } from '../validation';

const MODE_CHIPS: { key: ValidationMode; label: string; hint: string }[] = [
  {
    key: 'A',
    label: 'A — Mismo TLE (WTIA)',
    hint: 'Mismo TLE y mismo instante: aísla el error de nuestra implementación (solo ISS).',
  },
  {
    key: 'B',
    label: 'B — Error total (N2YO)',
    hint: 'Posición local vs N2YO, con az/el desde el observador (error total).',
  },
];

const ERROR_MESSAGES: Record<DataErrorCode, string> = {
  DATA_NETWORK: 'Error de red al contactar el proveedor de validación.',
  DATA_RATE_LIMITED:
    'Límite de peticiones del proveedor alcanzado; inténtelo más tarde.',
  DATA_PARSE: 'El proveedor devolvió una respuesta inesperada.',
  DATA_AUTH: 'Falta configurar la clave API de N2YO.',
  DATA_NOT_FOUND:
    'El proveedor no devolvió muestras para los instantes pedidos.',
  DATA_ALL_PROVIDERS_FAILED: 'Todos los proveedores de validación fallaron.',
};

/** Sample plan: 3 instants, 60 s apart (WTIA 1 req/s, N2YO now-forward). */
const SAMPLE_COUNT = 3;
const SAMPLE_STEP_MS = 60000;

function sampleTimestamps(nowMs: number): Date[] {
  return Array.from(
    { length: SAMPLE_COUNT },
    (_unused, index) => new Date(nowMs + index * SAMPLE_STEP_MS),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof DataError) {
    return ERROR_MESSAGES[error.code];
  }
  return 'No se pudo ejecutar la validación.';
}

function formatKm(value: number): string {
  return value.toFixed(3);
}

function formatDeg(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

export default function ValidationScreen() {
  const provider = useDataProvider();
  const [mode, setMode] = useState<ValidationMode>('A');
  const [running, setRunning] = useState(false);
  const [table, setTable] = useState<ErrorTable | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);

  async function onRun() {
    setRunning(true);
    setTable(null);
    setFailed(null);
    setExportText(null);
    try {
      const now = new Date();
      const reference = mode === 'A' ? 'wtia' : 'n2yo';
      const result = await runValidation(
        sourcesFromProvider(provider, reference),
        {
          mode,
          noradId: mode === 'A' ? ISS_NORAD_ID : getSelectedNoradId(),
          timestampsUtc: sampleTimestamps(now.getTime()),
          observer: getObserver(),
          fetchedAtUtc: now,
        },
      );
      setTable(result);
    } catch (error) {
      setFailed(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  async function onExport(kind: 'csv' | 'markdown') {
    if (!table) {
      return;
    }
    const text =
      kind === 'csv' ? errorTableToCsv(table) : errorTableToMarkdown(table);
    setExportText(text);
    try {
      await Share.share({ message: text });
    } catch {
      // Best-effort: the generated text stays visible for manual copy.
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.chips}>
        {MODE_CHIPS.map(chip => (
          <Pressable
            key={chip.key}
            onPress={() => setMode(chip.key)}
            style={[styles.chip, mode === chip.key && styles.chipActive]}
            testID={`mode-chip-${chip.key}`}
          >
            <Text
              style={[
                styles.chipLabel,
                mode === chip.key && styles.chipLabelActive,
              ]}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {MODE_CHIPS.find(chip => chip.key === mode)?.hint}
      </Text>
      <Pressable
        onPress={onRun}
        style={[styles.runButton, running && styles.runButtonBusy]}
        disabled={running}
        testID="run-button"
      >
        <Text style={styles.runButtonLabel}>
          {running ? 'Ejecutando...' : 'Ejecutar validación'}
        </Text>
      </Pressable>
      {failed && (
        <Text style={styles.error} testID="error-message">
          {failed}
        </Text>
      )}
      {!table && !failed && !running && (
        <Text style={styles.empty} testID="empty-message">
          Sin validaciones ejecutadas todavía.
        </Text>
      )}
      {table && (
        <View>
          <Text style={styles.summary} testID="validation-summary">
            {`Muestras: ${table.summary.sampleCount} · Error medio: ${formatKm(
              table.summary.meanErrorKm,
            )} km · Error máximo: ${formatKm(table.summary.maxErrorKm)} km`}
          </Text>
          <Text style={styles.elementSet} testID="element-set">
            {`Set orbital: epoch ${table.rows[0].elementEpochUtc.toISOString()} · descargado ${table.rows[0].elementFetchedAtUtc.toISOString()}`}
          </Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.cellTime]}>Instante (UTC)</Text>
            <Text style={styles.cell}>Error (km)</Text>
            <Text style={styles.cell}>Δ alt</Text>
            <Text style={styles.cell}>Δ az</Text>
            <Text style={styles.cell}>Δ el</Text>
            <Text style={styles.cell}>Edad (h)</Text>
          </View>
          {table.rows.map((row, index) => (
            <View
              key={row.timestampUtc.toISOString()}
              style={styles.tableRow}
              testID={`table-row-${index}`}
            >
              <Text style={[styles.cell, styles.cellTime]}>
                {row.timestampUtc.toISOString()}
              </Text>
              <Text style={styles.cell}>{formatKm(row.errorKm)}</Text>
              <Text style={styles.cell}>{formatKm(row.altitudeDeltaKm)}</Text>
              <Text style={styles.cell}>{formatDeg(row.azimuthDeltaDeg)}</Text>
              <Text style={styles.cell}>
                {formatDeg(row.elevationDeltaDeg)}
              </Text>
              <Text style={styles.cell}>{row.elementAgeHours.toFixed(1)}</Text>
            </View>
          ))}
          <View style={styles.exportRow}>
            <Pressable
              onPress={() => onExport('csv')}
              style={styles.exportButton}
              testID="export-csv"
            >
              <Text style={styles.exportLabel}>Exportar CSV</Text>
            </Pressable>
            <Pressable
              onPress={() => onExport('markdown')}
              style={styles.exportButton}
              testID="export-markdown"
            >
              <Text style={styles.exportLabel}>Exportar Markdown</Text>
            </Pressable>
          </View>
          {exportText && (
            <ScrollView horizontal>
              <Text style={styles.exportText} testID="export-text">
                {exportText}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
  },
  chipActive: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  chipLabel: {
    fontSize: 13,
    color: '#000000',
  },
  chipLabelActive: {
    color: '#FFFFFF',
  },
  hint: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 13,
    color: '#666666',
  },
  runButton: {
    margin: 16,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: '#000000',
    alignItems: 'center',
  },
  runButtonBusy: {
    backgroundColor: '#666666',
  },
  runButtonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#B00020',
    fontWeight: '600',
  },
  empty: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    fontSize: 14,
    color: '#666666',
  },
  summary: {
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#000000',
    fontWeight: '600',
  },
  elementSet: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    fontSize: 12,
    color: '#666666',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#000000',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCCCCC',
  },
  cell: {
    flex: 1,
    fontSize: 11,
    color: '#000000',
  },
  cellTime: {
    flex: 2.2,
    color: '#666666',
  },
  exportRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  exportButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
  },
  exportLabel: {
    fontSize: 13,
    color: '#000000',
    fontWeight: '600',
  },
  exportText: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    fontSize: 11,
    color: '#666666',
    fontFamily: 'monospace',
  },
});
