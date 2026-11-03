# Arquitectura — Satellite Tracker (TP7)

Referencias: enunciado `TP7_Satellite_Tracker.md`; plan `IMPLEMENTATION_PLAN.md`. Solo Android, React Native CLI + TypeScript estricto (patrón TP6).

## 1. Stack y matriz de librerías

[V] = viable, [A] = alternativa documentada, [R] = riesgo a validar empíricamente en su hito.
Verificado con `npm view <pkg> version time.modified peerDependencies` el 2026-11-03.

| Librería                                  | Versión      | Últ. pub.  | Peer RN                                                                | Estado                                                              | Uso                                                                         |
| ----------------------------------------- | ------------ | ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| react-native                              | 0.88.1       | 2026-11-02 | —                                                                      | [V]                                                                 | Base (misma línea que TP6 0.88.0)                                           |
| react                                     | 19.3.1       | 2026-10-31 | —                                                                      | [V]                                                                 |                                                                             |
| satellite.js                              | 7.1.0        | 2026-07    | JS puro                                                                | [V]                                                                 | Motor orbital SGP4/SDP4 (**indicada por la cátedra**)                       |
| react-native-maps                         | 1.29.11      | 2026-09-27 | >= 0.76.0                                                              | [V]                                                                 | Mapa: Marker/Polyline/Circle                                                |
| @maplibre/maplibre-react-native           | 11.5.1       | 2026-10-29 | >= 0.80.0 (+expo peer)                                                 | [A]                                                                 | Alternativa de mapa; se descarta por peer de expo                           |
| @op-engineering/op-sqlite                 | 19.0.3       | 2026-10-29 | *                                                                      | [V]                                                                 | Caché de catálogo y sets orbitales (MBs)                                    |
| @react-native-async-storage/async-storage | 3.1.1        | 2026-05-29 | *                                                                      | [V]                                                                 | Preferencias livianas (no catálogo)                                         |
| @notifee/react-native                     | 9.1.8        | 2024-12-20 | *                                                                      | [V]                                                                 | Notificaciones de pase (madura; push-notification descartada por deprecada) |
| react-native-background-fetch             | 4.4.2        | 2026-04-22 | * (+peer @expo/config-plugins ≥10 — validar si es opcional en install) | [R]                                                                 | Refresh de TLE y recálculo de pases                                         |
| react-native-geolocation-service          | 5.3.1        | 2022-09-23 | *                                                                      | [V] por evidencia TP6 (verificada en RN 0.88, emulador, 2026-10-25) | GPS del observador                                                          |
| @react-native-community/geolocation       | 3.4.0        | 2024-09-01 | *                                                                      | [A]                                                                 | Fallback GPS                                                                |
| react-native-sensors                      | 7.3.6        | 2022-11-21 | >= 0.39.0                                                              | [R]                                                                 | Magnetómetro (única opción RN CLI); validar compilando en Hito 7            |
| react-native-svg                          | 15.16.0      | 2026-10-15 | *                                                                      | [V]                                                                 | Sky chart polar                                                             |
| react-native-keychain                     | (TP6 10.0.0) | 2025-03    | *                                                                      | [V] por compilado TP6                                               | API key N2YO / credenciales Space-Track                                     |

Notas de compatibilidad:

- New Architecture obligatoria desde RN 0.82 (no desactivable): cada lib nativa se valida **empíricamente compilando en su hito** (lección TP6). Los peers declarados no alcanzan.
- satellite.js 7.1.0 es ESM con `exports` map: verificar resolución de Metro en Hito 1 (trámite esperado, no bloqueante).
- El build WASM que trae satellite.js NO corre en Hermes: queda como techo documentado del Hito 9, no como default.

## 2. Capas (mapping con la sección 5 del enunciado)

```
src/
├── orbital/        # Orbital Engine: satrec desde OMM/TLE, propagación, subpoint, look angles. Puro TS, sin red ni storage
├── passes/         # Prediction Service: AOS/LOS grueso→fino, datos del sky chart. Puro TS
├── geo/            # Utilidades de mapa: muestreo de ground track, corte de antimeridiano, radio de footprint
├── data/           # Data Provider Layer: DataProvider, CelesTrak/SpaceTrack/N2YO/WTIA, caché+TTL, rate limiter, fallback
├── db/             # op-sqlite: esquema, migraciones, repositories
├── observer/       # Observer Layer: GPS, ubicación manual, magnetómetro + declinación
├── notifications/  # Notification Layer: scheduling con notifee, background refresh
├── validation/     # Validation Layer: comparación vs N2YO/WTIA, error en km
├── screens/        # Mapa, Catálogo, Pases (sky chart), Validación, Configuración
├── components/
└── types/
```

Regla de dependencia: `orbital`, `passes`, `geo` no importan nada de React Native (testables con jest puro). `data` depende de `db`. Las capas de UI orquestan.

## 3. Modelo de datos (op-sqlite)

- `orbital_data`: `norad_id`, `name`, `source` (celestrak-gp | celestrak-supgp | spacetrack), `format` (omm | tle), `payload_json`, `epoch`, `fetched_at`. TTL de 12-24 h sobre `fetched_at`; edad del set = `epoch` (RF-16).
- `catalog_snapshot`: `norad_id`, `name`, `group` (starlink | iss | gps-ops | weather | …), `object_class`. Descargado de CelesTrak GP JSON; índice por `name` y `norad_id`.
- `app_settings` (k/v): elevación mínima, minutos de aviso, ubicación manual del observador, límite de la capa constelación. Secretos NO van acá: N2YO key y Space-Track van a Keychain.

Principio del enunciado respetado: las APIs se usan solo para datos orbitales (cada 12-24 h) y validación; **toda posición se calcula localmente con SGP4**, nunca en cada frame.

## 4. Decisiones de dominio

- **Formato principal OMM/JSON** (`json2satrec`): los NORAD ID de 6 dígitos (desde 2026-07-11) no tienen TLE. TLE queda como fallback legacy (`twoline2satrec`).
- **UTC end-to-end** en `orbital`/`passes`/`data`; hora local solo en presentación.
- **Ground track**: muestreo 30-60 s sobre ±1 órbita; dividir la polilínea cuando |Δlon| > 180° entre muestras consecutivas (antimeridiano).
- **Footprint**: radio angular β = acos((Re/(Re+h))·cos θ) − θ con θ = elevación mínima configurable; radio lineal = Re·β.
- **Búsqueda de pases**: paso grueso 30 s → detección de cruce del umbral de elevación → refinamiento por bisección (~1 s). Objetos de período > 225 min usan SDP4 vía el mismo satrec.
- **Declinación magnética**: valor manual configurable en Configuración (Buenos Aires ≈ −10°); documentar el error si no se corrige.
- **Estrategia de rendimiento**: propagación en lote + throttling del estado; sin Web Workers (no existen en RN).

## 5. Estrategia de pruebas

- **jest, capas puras** (sin red, sin dispositivo): `orbital` (fixtures congelados de ISS/GEO/Starlink de época fija; conversions rad/deg; satrec.error → ORBIT_*), `passes` (pase conocido ISS; GEO según latitud; umbral 0° vs 10°; satélite que no sale), `geo` (antimeridiano; radio de footprint), `data` (parse OMM/SupGP con fixtures, TTL vencido, rate limiter, fallback con proveedores falsos).
- La correctitud de SGP4 en sí la aporta satellite.js (suite propia del paquete); nuestro alcance es el wrapper y la matemática propia. La validación contra fuentes independientes (N2YO/WTIA) es el Hito 10 con método mismo-TLE+mismo-timestamp.
- **Manual en emulador** (como TP6): mapa, navegación, notificación. GPS con `adb emu geo fix`; magnetómetro con sensores virtuales del emulador.
- Matriz A/M/R final en `IMPLEMENTATION_PLAN.md` al cerrar el Hito 10.

## 6. Riesgos

| Riesgo                                                                          | Impacto                      | Mitigación                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Libs nativas vs New Arch (maps, bg-fetch, sensors)                              | Build fallido en su hito     | Validar compilando en el hito propio; alternativas ya documentadas (MapLibre, community/geolocation) |
| react-native-sensors sin mantenimiento (2022)                                   | Modo brújula limitado        | Spike en Hito 7; fallback: heading manual o solo az/el numérico + documentar                         |
| Background en Android (Doze)                                                    | Notificaciones tardías       | `background-fetch` con ventana tolerante; validar en dispositivo (humano)                            |
| Metro vs ESM `exports` de satellite.js                                          | Resolución de módulo fallida | Verificar en Hito 1; si falla: alias/transpile en metro.config.js                                    |
| Rendimiento de la constelación                                                  | UI degradada                 | Límite configurable, lote+throttle; techo: WASM (requiere evaluar soporte Hermes)                    |
| Límites de API (N2YO 1000/h y 100/h pases; WTIA 1/s; Space-Track por confirmar) | 429/ban                      | Rate limiter por proveedor + caché TTL; APIs solo para datos y validación                            |
| Emulador sin cielo real / GPS físico                                            | Validación parcial           | Ubicación manual + `geo fix`; dispositivo físico queda (humano)                                      |

## 7. Build y ejecución

- Entorno (de TP6): JDK 21, Android SDK, emulador `Medium_Phone_API_36.1`. Ruta `C:\Users\camil\Proyectos\TP7` ya es corta (lección de MAX_PATH del TP6).
- Build: `cd android && .\gradlew.bat assembleDebug` (agregar `-PreactNativeArchitectures=arm64-v8a,x86_64` si el tiempo de build molesta).
- Ejecución debug: `npx react-native start` + `adb reverse tcp:8081 tcp:8081` (esperado en debug, no es bug).
- Commit style: conventional, sin atribución de IA. Un hito por sesión; `IMPLEMENTATION_PLAN.md` es el único tracker.
