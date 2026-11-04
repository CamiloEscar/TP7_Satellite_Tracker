import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import {
  cardinalLabel,
  normalizeDeg,
  trueHeadingFromMagnetic,
} from '../observer/compass';
import {
  MagnetometerHeadingSource,
  ManualHeadingSource,
} from '../observer/heading';
import type { HeadingSource } from '../observer/heading';

export type CompassOverlayProps = {
  /** Magnetic declination in degrees (positive east). */
  declinationDeg: number;
  /** Absolute azimuth of the selected satellite in degrees. */
  satelliteAzimuthDeg: number;
};

const SIZE = 220;
const CENTER = SIZE / 2;
const RING_RADIUS = 84;
const LABEL_RADIUS = RING_RADIUS - 18;
const NEEDLE_RADIUS = RING_RADIUS - 12;
const CARDINAL_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/** N-up screen point for a compass angle (clockwise from north). */
function point(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(rad),
    y: CENTER - radius * Math.cos(rad),
  };
}

/**
 * Compass overlay: N-up cardinal ring, declination-corrected true-heading
 * needle and a satellite marker whose offset from the needle is the
 * relative bearing (satellite azimuth - true heading). If the magnetometer
 * reports unavailable the overlay falls back to a manual magnetic heading.
 */
export default function CompassOverlay({
  declinationDeg,
  satelliteAzimuthDeg,
}: CompassOverlayProps) {
  const [source, setSource] = useState<HeadingSource>(
    () => new MagnetometerHeadingSource(),
  );
  const [manual] = useState(() => new ManualHeadingSource());
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const reading = useSyncExternalStore(source.subscribe, source.getReading);
  const usingManual = source === manual;

  useEffect(() => {
    if (reading.status === 'unavailable' && !usingManual) {
      setSource(manual);
    }
  }, [reading, usingManual, manual]);

  const magneticHeadingDeg =
    reading.status === 'ok' ? reading.magneticHeadingDeg : null;
  const trueHeadingDeg =
    magneticHeadingDeg === null
      ? null
      : trueHeadingFromMagnetic(magneticHeadingDeg, declinationDeg);
  // The marker sits this many degrees clockwise from the needle.
  const relativeBearingDeg =
    trueHeadingDeg === null
      ? null
      : normalizeDeg(satelliteAzimuthDeg - trueHeadingDeg);

  const applyManual = () => {
    const value = Number(manualInput.trim());
    if (!Number.isFinite(value)) {
      setManualError('Valor de rumbo inválido.');
      return;
    }
    setManualError(null);
    manual.setHeading(value);
  };

  const needlePoint =
    trueHeadingDeg === null ? null : point(trueHeadingDeg, NEEDLE_RADIUS);
  const markerPoint = point(satelliteAzimuthDeg, RING_RADIUS);

  return (
    <View style={styles.container} testID="compass-overlay">
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          stroke="#CCCCCC"
          strokeWidth={1}
          fill="none"
        />
        {CARDINAL_ANGLES.map(angleDeg => {
          const labelPoint = point(angleDeg, LABEL_RADIUS);
          return (
            <SvgText
              key={angleDeg}
              x={labelPoint.x}
              y={labelPoint.y + 4}
              fontSize={11}
              textAnchor="middle"
              fill="#666666"
            >
              {cardinalLabel(angleDeg)}
            </SvgText>
          );
        })}
        {needlePoint && (
          <Line
            x1={CENTER}
            y1={CENTER}
            x2={needlePoint.x}
            y2={needlePoint.y}
            stroke="#000000"
            strokeWidth={3}
          />
        )}
        <Circle cx={markerPoint.x} cy={markerPoint.y} r={6} fill="#D32F2F" />
      </Svg>
      <Text style={styles.readout} testID="compass-heading-readout">
        {trueHeadingDeg === null
          ? 'Rumbo verdadero: —'
          : `Rumbo verdadero: ${trueHeadingDeg.toFixed(1)}° (${cardinalLabel(
              trueHeadingDeg,
            )})`}
      </Text>
      <Text style={styles.readout}>
        {relativeBearingDeg === null
          ? 'Ángulo al satélite: —'
          : `Ángulo al satélite: ${relativeBearingDeg.toFixed(1)}°`}
      </Text>
      {reading.status === 'starting' && !usingManual && (
        <Text style={styles.note}>Esperando lectura del magnetómetro...</Text>
      )}
      {usingManual && (
        <View style={styles.manualBox}>
          <Text style={styles.note} testID="compass-fallback-message">
            Magnetómetro no disponible. Ingrese el rumbo magnético manualmente.
          </Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              testID="compass-manual-heading"
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="Rumbo magnético (°)"
            />
            <Pressable
              style={styles.manualButton}
              testID="compass-manual-apply"
              onPress={applyManual}
            >
              <Text style={styles.manualButtonLabel}>Usar rumbo</Text>
            </Pressable>
          </View>
          {manualError && <Text style={styles.error}>{manualError}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFFF2',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  readout: {
    fontSize: 13,
    color: '#000000',
    marginTop: 2,
  },
  note: {
    fontSize: 12,
    color: '#666666',
    marginTop: 4,
    textAlign: 'center',
  },
  manualBox: {
    marginTop: 4,
    alignItems: 'center',
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  manualInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 120,
  },
  manualButton: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  manualButtonLabel: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  error: {
    fontSize: 12,
    color: '#D32F2F',
    marginTop: 4,
  },
});
