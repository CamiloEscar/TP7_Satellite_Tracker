import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  PermissionsAndroid,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import {
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
  createNotificationService,
  getLeadMinutes,
  notifeePort,
  setLeadMinutes,
} from '../notifications';
import type { NotificationPermissionState } from '../notifications';
import {
  DEFAULT_DECLINATION_DEG,
  getDeclinationDeg,
  getObserver,
  gpsErrorToResult,
  gpsPositionToResult,
  parseManualLocation,
  setDeclinationDeg,
  setObserver,
  subscribeObserver,
} from '../observer';
import type { LocationResult, ManualLocationField } from '../observer';

type GpsStatus = 'idle' | 'loading' | LocationResult['status'];

type ManualStatus =
  | { kind: 'saved' }
  | { kind: 'invalid'; field: ManualLocationField }
  | null;

const GPS_MESSAGES: Record<string, string> = {
  loading: 'Obteniendo ubicación GPS...',
  ok: 'Ubicación actualizada por GPS.',
  permission_denied: 'Permiso de ubicación rechazado. Use la ubicación manual.',
  position_unavailable:
    'Posición no disponible (GPS desactivado o sin proveedor).',
  timeout: 'Sin señal GPS: se agotó el tiempo de espera.',
};

const MANUAL_FIELD_MESSAGES: Record<ManualLocationField, string> = {
  latitude: 'Latitud fuera de rango (-90 a 90).',
  longitude: 'Longitud fuera de rango (-180 a 180).',
  altitude: 'Altitud fuera de rango (-1 a 100 km).',
};

async function requestLocationPermission(): Promise<boolean> {
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  const isGranted = (status: string | undefined) =>
    status === PermissionsAndroid.RESULTS.GRANTED;
  return (
    isGranted(granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]) ||
    isGranted(granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION])
  );
}

/**
 * Observer section: GPS fix with distinct error states, manual lat/lon/alt
 * form and the magnetic declination setting for the compass overlay.
 */
// ponytail: settings are in-memory only - there is no `app_settings` table
// yet in `src/db/schema.ts`. Upgrade path: persist in the settings k/v
// table when the settings work lands (Hito 8+).
export default function SettingsScreen() {
  const observer = useSyncExternalStore(subscribeObserver, getObserver);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [latitudeText, setLatitudeText] = useState(
    String(observer.latitudeDeg),
  );
  const [longitudeText, setLongitudeText] = useState(
    String(observer.longitudeDeg),
  );
  const [altitudeText, setAltitudeText] = useState(String(observer.altitudeKm));
  const [manualStatus, setManualStatus] = useState<ManualStatus>(null);
  const [declinationText, setDeclinationText] = useState(
    String(getDeclinationDeg()),
  );
  const [declinationStatus, setDeclinationStatus] = useState<string | null>(
    null,
  );
  const [leadText, setLeadText] = useState(String(getLeadMinutes()));
  const [leadStatus, setLeadStatus] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState | null>(null);

  useEffect(() => {
    let cancelled = false;
    createNotificationService(notifeePort())
      .ensureReady()
      .then(state => {
        if (!cancelled) {
          setNotificationPermission(state);
        }
      })
      .catch(() => {
        // Native module unavailable: leave the state unset instead of crashing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestGpsLocation = async () => {
    setGpsStatus('loading');
    const granted = await requestLocationPermission();
    if (!granted) {
      setGpsStatus('permission_denied');
      return;
    }
    Geolocation.getCurrentPosition(
      position => {
        const result = gpsPositionToResult(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.altitude,
        );
        if (result.status === 'ok') {
          setObserver(result.observer);
        }
        setGpsStatus(result.status);
      },
      error => {
        setGpsStatus(gpsErrorToResult(error.code).status);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  };

  const saveManualLocation = () => {
    const result = parseManualLocation({
      latitudeDeg: latitudeText,
      longitudeDeg: longitudeText,
      altitudeKm: altitudeText,
    });
    if (result.status === 'invalid') {
      setManualStatus({ kind: 'invalid', field: result.field });
      return;
    }
    setObserver(result.observer);
    setManualStatus({ kind: 'saved' });
  };

  const saveDeclination = () => {
    const value = Number(declinationText.trim());
    if (
      declinationText.trim() === '' ||
      !Number.isFinite(value) ||
      value < -180 ||
      value > 180
    ) {
      setDeclinationStatus('Declinación fuera de rango (-180 a 180).');
      return;
    }
    setDeclinationDeg(value);
    setDeclinationStatus(`Declinación guardada: ${value}°`);
  };

  const saveLead = () => {
    const value = Number(leadText.trim());
    if (
      leadText.trim() === '' ||
      !Number.isInteger(value) ||
      value < MIN_LEAD_MINUTES ||
      value > MAX_LEAD_MINUTES
    ) {
      setLeadStatus('Minutos de aviso fuera de rango (1 a 120).');
      return;
    }
    setLeadMinutes(value);
    setLeadStatus(`Aviso guardado: ${value} min`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Ubicación del observador</Text>
      <Text style={styles.readout} testID="observer-readout">
        Lat: {observer.latitudeDeg.toFixed(4)}° Lon:{' '}
        {observer.longitudeDeg.toFixed(4)}° Alt:{' '}
        {observer.altitudeKm.toFixed(3)} km
      </Text>
      <Pressable
        style={styles.button}
        testID="use-gps-button"
        onPress={requestGpsLocation}
      >
        <Text style={styles.buttonLabel}>Usar GPS</Text>
      </Pressable>
      {gpsStatus !== 'idle' && (
        <Text style={styles.status} testID="gps-status">
          {GPS_MESSAGES[gpsStatus]}
        </Text>
      )}
      <Text style={styles.fieldLabel}>Latitud (°)</Text>
      <TextInput
        style={styles.input}
        testID="manual-lat"
        value={latitudeText}
        onChangeText={setLatitudeText}
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.fieldLabel}>Longitud (°)</Text>
      <TextInput
        style={styles.input}
        testID="manual-lon"
        value={longitudeText}
        onChangeText={setLongitudeText}
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.fieldLabel}>Altitud (km)</Text>
      <TextInput
        style={styles.input}
        testID="manual-alt"
        value={altitudeText}
        onChangeText={setAltitudeText}
        keyboardType="numbers-and-punctuation"
      />
      <Pressable
        style={styles.button}
        testID="save-manual-button"
        onPress={saveManualLocation}
      >
        <Text style={styles.buttonLabel}>Guardar ubicación</Text>
      </Pressable>
      {manualStatus && (
        <Text style={styles.status} testID="manual-status">
          {manualStatus.kind === 'saved'
            ? 'Ubicación guardada.'
            : MANUAL_FIELD_MESSAGES[manualStatus.field]}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Brújula</Text>
      <Text style={styles.note}>
        La declinación magnética corrige el rumbo del magnetómetro (positivo al
        este). Buenos Aires: {DEFAULT_DECLINATION_DEG}°.
      </Text>
      <Text style={styles.fieldLabel}>Declinación magnética (°)</Text>
      <TextInput
        style={styles.input}
        testID="declination-input"
        value={declinationText}
        onChangeText={setDeclinationText}
        keyboardType="numbers-and-punctuation"
      />
      <Pressable
        style={styles.button}
        testID="save-declination-button"
        onPress={saveDeclination}
      >
        <Text style={styles.buttonLabel}>Guardar declinación</Text>
      </Pressable>
      {declinationStatus && (
        <Text style={styles.status} testID="declination-status">
          {declinationStatus}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Notificaciones</Text>
      <Text style={styles.note}>
        Aviso previo al próximo pase del satélite seleccionado.
      </Text>
      <Text style={styles.fieldLabel}>Aviso antes del pase (min)</Text>
      <TextInput
        style={styles.input}
        testID="lead-input"
        value={leadText}
        onChangeText={setLeadText}
        keyboardType="numbers-and-punctuation"
      />
      <Pressable
        style={styles.button}
        testID="save-lead-button"
        onPress={saveLead}
      >
        <Text style={styles.buttonLabel}>Guardar aviso</Text>
      </Pressable>
      {leadStatus && (
        <Text style={styles.status} testID="lead-status">
          {leadStatus}
        </Text>
      )}
      {notificationPermission && !notificationPermission.granted && (
        <Text style={styles.status} testID="notification-permission-status">
          {notificationPermission.message}
        </Text>
      )}
      <View style={styles.footer} />
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginTop: 12,
    marginBottom: 8,
  },
  readout: {
    fontSize: 14,
    color: '#000000',
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#666666',
    marginTop: 8,
    marginBottom: 2,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: '#000000',
  },
  button: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  status: {
    fontSize: 13,
    color: '#666666',
    marginTop: 8,
  },
  note: {
    fontSize: 12,
    color: '#666666',
  },
  footer: {
    height: 24,
  },
});
