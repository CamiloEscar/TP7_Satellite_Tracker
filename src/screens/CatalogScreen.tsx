import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EmptyState from '../components/EmptyState';
import { useDataProvider } from '../dataProviderContext';
import type {
  CacheHit,
  CatalogEntry,
  CatalogGroup,
  CatalogGroupFilter,
} from '../data';
import {
  DATA_TTL_MS,
  filterCatalog,
  formatDataAge,
  isDataOverTtl,
} from '../data';
import type { RootStackParamList } from '../types';

export type CatalogScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Catalogo'
>;

const GROUP_CHIPS: { key: CatalogGroupFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'starlink', label: 'Starlink' },
  { key: 'iss', label: 'ISS' },
  { key: 'gps-ops', label: 'GPS operacional' },
  { key: 'weather', label: 'Meteorológicos' },
  { key: 'other', label: 'Otros' },
];

const GROUP_LABELS: Record<CatalogGroup, string> = {
  starlink: 'Starlink',
  iss: 'ISS',
  'gps-ops': 'GPS operacional',
  weather: 'Meteorológico',
  other: 'Otro',
};

export default function CatalogScreen({ navigation }: CatalogScreenProps) {
  const provider = useDataProvider();
  const [meta, setMeta] = useState<CacheHit<CatalogEntry[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<CatalogGroupFilter>('all');

  useEffect(() => {
    let cancelled = false;
    provider
      .getCatalogWithMeta()
      .then(hit => {
        if (!cancelled) {
          setMeta(hit);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  if (failed) {
    return <EmptyState message="No se pudo cargar el catálogo." />;
  }
  if (!meta) {
    return <EmptyState message="Cargando catálogo..." />;
  }

  const results = filterCatalog(meta.value, query, group);
  const overTtl = isDataOverTtl(meta.ageMs, DATA_TTL_MS);

  return (
    <View style={styles.container}>
      <View style={styles.ageRow}>
        <Text
          style={[styles.ageBadge, overTtl && styles.ageBadgeStale]}
          testID="age-badge"
        >
          Datos: {formatDataAge(meta.ageMs)}
        </Text>
        {overTtl && (
          <Text style={styles.ageWarning} testID="age-warning">
            Datos desactualizados
          </Text>
        )}
      </View>
      <TextInput
        style={styles.search}
        placeholder="Buscar por nombre o NORAD ID"
        placeholderTextColor="#999999"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <View style={styles.chips}>
        {GROUP_CHIPS.map(chip => (
          <Pressable
            key={chip.key}
            onPress={() => setGroup(chip.key)}
            style={[styles.chip, group === chip.key && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipLabel,
                group === chip.key && styles.chipLabelActive,
              ]}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={results}
        keyExtractor={item => String(item.noradId)}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() =>
              navigation.navigate('CatalogDetail', {
                noradId: item.noradId,
                name: item.name,
              })
            }
          >
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowMeta}>
              NORAD {item.noradId} · {GROUP_LABELS[item.group]}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState message="Sin resultados." />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  ageBadge: {
    fontSize: 13,
    color: '#666666',
  },
  ageBadgeStale: {
    color: '#B00020',
    fontWeight: '600',
  },
  ageWarning: {
    fontSize: 13,
    color: '#B00020',
    fontWeight: '600',
  },
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 6,
    fontSize: 15,
    color: '#000000',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCCCCC',
  },
  rowPressed: {
    backgroundColor: '#EEEEEE',
  },
  rowName: {
    fontSize: 16,
    color: '#000000',
  },
  rowMeta: {
    fontSize: 13,
    color: '#666666',
    marginTop: 2,
  },
});
