import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EmptyState from '../components/EmptyState';
import { useDataProvider } from '../dataProviderContext';
import type { OrbitalRecord } from '../data';
import { setSelectedNoradId } from '../selection';
import type { RootStackParamList } from '../types';

export type CatalogDetailScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'CatalogDetail'
>;

export default function CatalogDetailScreen({
  navigation,
  route,
}: CatalogDetailScreenProps) {
  const provider = useDataProvider();
  const { noradId } = route.params;
  const [record, setRecord] = useState<OrbitalRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    provider
      .getOrbitalData(noradId)
      .then(result => {
        if (!cancelled) {
          setRecord(result);
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
  }, [provider, noradId]);

  if (failed) {
    return <EmptyState message="No se pudieron cargar los datos orbitales." />;
  }
  if (!record) {
    return <EmptyState message="Cargando datos orbitales..." />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{record.name}</Text>
      <Text style={styles.field}>NORAD ID: {record.noradId}</Text>
      <Text style={styles.field}>
        Epoch (UTC): {record.epoch.toISOString()}
      </Text>
      <Text style={styles.field}>Fuente: {record.source}</Text>
      <Text style={styles.field}>
        Descargado (UTC): {record.fetchedAt.toISOString()}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.mapButton,
          pressed && styles.mapButtonPressed,
        ]}
        onPress={() => {
          setSelectedNoradId(noradId);
          navigation.navigate('Mapa');
        }}
      >
        <Text style={styles.mapButtonLabel}>Ver en mapa</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 12,
  },
  field: {
    fontSize: 15,
    color: '#000000',
    marginBottom: 8,
  },
  mapButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#000000',
    alignItems: 'center',
  },
  mapButtonPressed: {
    opacity: 0.7,
  },
  mapButtonLabel: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
