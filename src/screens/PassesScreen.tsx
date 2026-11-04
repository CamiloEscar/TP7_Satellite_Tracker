import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EmptyState from '../components/EmptyState';
import { useDataProvider } from '../dataProviderContext';
import type { OrbitalRecord } from '../data';
import { getObserver, subscribeObserver } from '../observer';
import {
  createSatrecFromOmm,
  createSatrecFromTle,
  lookAnglesAt,
} from '../orbital';
import type { LookAnglesResult, ObserverGeodetic, Satrec } from '../orbital';
import {
  elevationRingRadius,
  findUpcomingPasses,
  projectSkyPoint,
  samplePassTrajectory,
} from '../passes';
import type { PassSummary, TrajectorySample } from '../passes';
import { getSelectedNoradId, subscribeSelectedNoradId } from '../selection';
import type { RootStackParamList } from '../types';

/** Pass search seam; tests inject a fake to skip multi-hour searches. */
export type ComputePasses = (
  satrec: Satrec,
  observer: ObserverGeodetic,
  fromUtc: Date,
  minElevationDeg: number,
) => PassSummary[];

export type PassesScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Pases'
> & {
  /** Injectable UTC clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
  /** Injectable pass search for tests. Defaults to `findUpcomingPasses`. */
  computePasses?: ComputePasses;
};

const defaultComputePasses: ComputePasses = (
  satrec,
  observer,
  fromUtc,
  minElevationDeg,
) => findUpcomingPasses(satrec, observer, fromUtc, { minElevationDeg });

/** Minimum-elevation presets (degrees), same family as the map screen. */
const ELEVATION_PRESETS = [0, 5, 10, 20];
const DEFAULT_MIN_ELEVATION_DEG = 10;

const CHART_SIZE = 240;
const CHART_RADIUS = CHART_SIZE / 2 - 4;
const RING_ELEVATIONS = [0, 30, 60, 90];

interface SkyChartProps {
  trajectory: TrajectorySample[];
  current: LookAnglesResult | null;
}

/**
 * Thin polar sky chart: all geometry comes from the pure projection
 * functions in `src/passes/skyChart.ts` (zenith center, horizon edge,
 * north up).
 */
function SkyChart({ trajectory, current }: SkyChartProps) {
  const center = CHART_SIZE / 2;
  const project = (azimuthDeg: number, elevationDeg: number) => {
    const point = projectSkyPoint(azimuthDeg, elevationDeg, CHART_RADIUS);
    return { x: center + point.x, y: center + point.y };
  };
  const currentPoint =
    current && current.elevationDeg >= 0
      ? project(current.azimuthDeg, current.elevationDeg)
      : null;
  return (
    <Svg
      width={CHART_SIZE}
      height={CHART_SIZE}
      viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
    >
      {RING_ELEVATIONS.map(elevationDeg => (
        <Circle
          key={elevationDeg}
          cx={center}
          cy={center}
          r={elevationRingRadius(elevationDeg, CHART_RADIUS)}
          stroke="#CCCCCC"
          strokeWidth={1}
          fill="none"
        />
      ))}
      {trajectory.length > 0 && (
        <Polyline
          points={trajectory
            .map(sample => {
              const point = project(sample.azimuthDeg, sample.elevationDeg);
              return `${point.x},${point.y}`;
            })
            .join(' ')}
          stroke="#1E88E5"
          strokeWidth={2}
          fill="none"
        />
      )}
      {currentPoint && (
        <Circle cx={currentPoint.x} cy={currentPoint.y} r={5} fill="#D32F2F" />
      )}
      <SvgText
        x={center}
        y={12}
        fontSize={12}
        textAnchor="middle"
        fill="#666666"
      >
        N
      </SvgText>
    </Svg>
  );
}

export default function PassesScreen({
  now,
  computePasses = defaultComputePasses,
}: PassesScreenProps) {
  const provider = useDataProvider();
  const observer = useSyncExternalStore(subscribeObserver, getObserver);
  const selectedNoradId = useSyncExternalStore(
    subscribeSelectedNoradId,
    getSelectedNoradId,
  );
  const [record, setRecord] = useState<OrbitalRecord | null>(null);
  const [satrec, setSatrec] = useState<Satrec | null>(null);
  const [failed, setFailed] = useState(false);
  const [passes, setPasses] = useState<PassSummary[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [minElevationDeg, setMinElevationDeg] = useState(
    DEFAULT_MIN_ELEVATION_DEG,
  );

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setSatrec(null);
    setFailed(false);
    setPasses(null);
    provider
      .getOrbitalData(selectedNoradId)
      .then(result => {
        const built =
          result.format === 'omm'
            ? createSatrecFromOmm(result.payload)
            : createSatrecFromTle(result.payload.line1, result.payload.line2);
        if (!cancelled) {
          setRecord(result);
          setSatrec(built);
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
  }, [provider, selectedNoradId]);

  useEffect(() => {
    if (!satrec) {
      return;
    }
    try {
      setPasses(
        computePasses(satrec, observer, now ?? new Date(), minElevationDeg),
      );
      setSelectedIndex(0);
    } catch {
      setFailed(true);
    }
  }, [satrec, observer, minElevationDeg, now, computePasses]);

  const selectedPass = passes?.[selectedIndex] ?? null;

  const trajectory = useMemo(() => {
    if (!satrec || !selectedPass) {
      return [];
    }
    try {
      return samplePassTrajectory(
        satrec,
        observer,
        selectedPass.aosUtc,
        selectedPass.losUtc,
      );
    } catch {
      return [];
    }
  }, [satrec, observer, selectedPass]);

  const currentPosition = useMemo(() => {
    if (!satrec) {
      return null;
    }
    try {
      return lookAnglesAt(satrec, observer, now ?? new Date());
    } catch {
      return null;
    }
  }, [satrec, observer, now]);

  if (failed) {
    return <EmptyState message="No se pudieron calcular los pases." />;
  }
  if (!record || !satrec || passes === null) {
    return <EmptyState message="Cargando pases del satélite..." />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.satName}>
        {record.name} (NORAD {record.noradId})
      </Text>
      <View style={styles.chips}>
        <Text style={styles.chipsLabel}>Elevación mínima:</Text>
        {ELEVATION_PRESETS.map(degrees => (
          <Pressable
            key={degrees}
            testID={`threshold-chip-${degrees}`}
            onPress={() => setMinElevationDeg(degrees)}
            style={[
              styles.chip,
              minElevationDeg === degrees && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                minElevationDeg === degrees && styles.chipLabelActive,
              ]}
            >
              {degrees}°
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chartBox}>
        <SkyChart trajectory={trajectory} current={currentPosition} />
      </View>
      {passes.length === 0 ? (
        <EmptyState message="Sin pases sobre el umbral en la ventana de búsqueda." />
      ) : (
        passes.map((pass, index) => (
          <Pressable
            key={pass.aosUtc.toISOString()}
            testID={`pass-row-${index}`}
            onPress={() => setSelectedIndex(index)}
            style={[
              styles.passRow,
              selectedIndex === index && styles.passRowActive,
            ]}
          >
            <Text style={styles.passLine}>
              {`AOS: ${pass.aosUtc.toISOString()} · Az ${pass.aosAzimuthDeg.toFixed(
                1,
              )}°`}
            </Text>
            <Text style={styles.passLine}>
              {`Máximo: ${pass.maxUtc.toISOString()} · El ${pass.maxElevationDeg.toFixed(
                1,
              )}°`}
            </Text>
            <Text style={styles.passLine}>
              {`LOS: ${pass.losUtc.toISOString()} · Az ${pass.losAzimuthDeg.toFixed(
                1,
              )}°`}
            </Text>
            <Text
              style={styles.passLine}
            >{`Duración: ${pass.durationS} s`}</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  satName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 6,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  chipsLabel: {
    fontSize: 13,
    color: '#666666',
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
  chartBox: {
    alignItems: 'center',
    marginBottom: 12,
  },
  passRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  passRowActive: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  passLine: {
    fontSize: 13,
    color: '#000000',
    marginBottom: 2,
  },
});
