import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EmptyState from '../components/EmptyState';
import { useDataProvider } from '../dataProviderContext';
import type { OrbitalRecord } from '../data';
import {
  footprintPolygonKm,
  footprintRadiusKm,
  sampleGroundTrack,
  splitAtAntimeridian,
} from '../geo';
import type { GeoJsonPosition, GroundTrackSample, LatLon } from '../geo';
import {
  createSatrecFromOmm,
  createSatrecFromTle,
  subpointAt,
} from '../orbital';
import type { Satrec, SubpointResult } from '../orbital';
import { getSelectedNoradId, subscribeSelectedNoradId } from '../selection';
import type { RootStackParamList } from '../types';

export type MapScreenProps = NativeStackScreenProps<RootStackParamList, 'Mapa'>;

/** Minimum-elevation presets (degrees) for the footprint circle. */
const ELEVATION_PRESETS = [0, 5, 10, 20];
const DEFAULT_MIN_ELEVATION_DEG = 10;

// ponytail: refresh hardcoded at 2.5 s (spec range 1-5 s); expose it in the
// Hito 8 settings screen only if the user actually asks for it.
const POSITION_REFRESH_MS = 2500;

interface MarkerPosition extends SubpointResult {
  timeUTC: Date;
}

/** GeoJSON order: [longitude, latitude] — the reverse of `LatLon` fields. */
function toPosition(point: LatLon): GeoJsonPosition {
  return [point.longitudeDeg, point.latitudeDeg];
}

// Keyless OSM raster tiles. Attribution is required by the OSM tile usage
// policy (https://operations.osm.org/policies/tiles/); keep it attached to
// the source so the map credits OpenStreetMap contributors.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function MapScreen({ route }: MapScreenProps) {
  const provider = useDataProvider();
  const selectedNoradId = useSyncExternalStore(
    subscribeSelectedNoradId,
    getSelectedNoradId,
  );
  const noradId = route.params?.noradId ?? selectedNoradId;
  const [record, setRecord] = useState<OrbitalRecord | null>(null);
  const [satrec, setSatrec] = useState<Satrec | null>(null);
  const [failed, setFailed] = useState(false);
  const [track, setTrack] = useState<GroundTrackSample[]>([]);
  const [position, setPosition] = useState<MarkerPosition | null>(null);
  const [minElevationDeg, setMinElevationDeg] = useState(
    DEFAULT_MIN_ELEVATION_DEG,
  );

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setSatrec(null);
    setFailed(false);
    provider
      .getOrbitalData(noradId)
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
  }, [provider, noradId]);

  useEffect(() => {
    if (!satrec) {
      return;
    }
    try {
      // Batch: the whole ±1 orbit track is sampled once per selection, not
      // per frame and not per render.
      setTrack(sampleGroundTrack(satrec, new Date()));
    } catch {
      setFailed(true);
      return;
    }
    const update = () => {
      try {
        const timeUTC = new Date();
        setPosition({ ...subpointAt(satrec, timeUTC), timeUTC });
      } catch {
        setFailed(true);
      }
    };
    update();
    const refresh = setInterval(update, POSITION_REFRESH_MS);
    return () => clearInterval(refresh);
  }, [satrec]);

  const segments = useMemo(() => splitAtAntimeridian(track), [track]);
  const trackGeoJson = useMemo<GeoJSON.MultiLineString>(
    () => ({
      type: 'MultiLineString',
      // GeoJSON positions are [longitude, latitude]; `toPosition` converts.
      coordinates: segments.map(segment => segment.map(toPosition)),
    }),
    [segments],
  );

  if (failed) {
    return <EmptyState message="No se pudieron cargar los datos orbitales." />;
  }
  if (!record || !position) {
    return <EmptyState message="Cargando posición del satélite..." />;
  }

  const positionLngLat = toPosition(position);
  const footprintGeoJson: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      footprintPolygonKm(
        position.latitudeDeg,
        position.longitudeDeg,
        footprintRadiusKm(position.altitudeKm, minElevationDeg),
      ),
    ],
  };
  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={OSM_STYLE}>
        {/* Recenter only when the satellite changes (keyed like the old
            initialRegion remount). Zoom 2.5 ≈ the old 60° latitudeDelta. */}
        <Camera
          key={noradId}
          initialViewState={{ center: positionLngLat, zoom: 2.5 }}
        />
        <Marker lngLat={positionLngLat}>
          <View style={styles.markerDot} />
        </Marker>
        <GeoJSONSource data={trackGeoJson}>
          <Layer
            type="line"
            paint={{ 'line-color': '#1E88E5', 'line-width': 2 }}
          />
        </GeoJSONSource>
        <GeoJSONSource data={footprintGeoJson}>
          <Layer
            type="fill"
            paint={{ 'fill-color': '#1E88E5', 'fill-opacity': 0.15 }}
          />
        </GeoJSONSource>
      </Map>
      <View style={styles.readout}>
        <Text style={styles.satName}>
          {record.name} (NORAD {record.noradId})
        </Text>
        <Text style={styles.positionText} testID="position-readout">
          Lat: {position.latitudeDeg.toFixed(3)}° Lon:{' '}
          {position.longitudeDeg.toFixed(3)}° Alt:{' '}
          {position.altitudeKm.toFixed(1)} km
        </Text>
        <Text style={styles.positionText}>
          Hora (UTC): {position.timeUTC.toISOString()}
        </Text>
        <View style={styles.chips}>
          <Text style={styles.chipsLabel}>Elevación mínima:</Text>
          {ELEVATION_PRESETS.map(degrees => (
            <Pressable
              key={degrees}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#D32F2F',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  readout: {
    padding: 16,
  },
  satName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 6,
  },
  positionText: {
    fontSize: 14,
    color: '#000000',
    marginBottom: 4,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
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
});
