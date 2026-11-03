# Plan de implementación — Satellite Tracker (TP7)

Estados: `Pendiente` · `En progreso` · `Implementado` · `Verificado` (probado de verdad, con evidencia).

Forma de trabajo (heredada del TP6): un hito por sesión; este archivo es el único tracker; `Verificado` exige comando + salida registrada; distinguir siempre real vs simulado; conventional commits sin atribución de IA; no compilar tras cambios menores.

## Requisitos

| ID    | Requisito                                                  | Hito | Estado    | Evidencia |
| ----- | ---------------------------------------------------------- | ---- | --------- | --------- |
| RF-01 | Buscar/seleccionar satélites por nombre o NORAD ID         | 4    | Pendiente |           |
| RF-02 | Posición actual (lat/lon/alt) vía SGP4 local               | 2, 5 | Pendiente |           |
| RF-03 | Azimut/elevación respecto del observador                   | 2, 7 | Pendiente |           |
| RF-04 | Ventanas de visibilidad (AOS, máximo, LOS)                 | 6    | Pendiente |           |
| RF-05 | Sky chart polar SVG                                        | 6    | Pendiente |           |
| RF-06 | Notificación N minutos antes del pase                      | 8    | Pendiente |           |
| RF-07 | Modo brújula (overlay de orientación)                      | 7    | Pendiente |           |
| RF-08 | Filtrar catálogo por constelación                          | 4    | Pendiente |           |
| RF-09 | Auto-refresh de datos orbitales por TTL (12-24 h)          | 3, 8 | Pendiente |           |
| RF-10 | Mapa con posición en tiempo real (refresco 1-5 s local)    | 5    | Pendiente |           |
| RF-11 | Ground track ±1 órbita con corte de antimeridiano          | 5    | Pendiente |           |
| RF-12 | Footprint según altitud y elevación mínima configurable    | 5    | Pendiente |           |
| RF-13 | Capa de constelación (subconjunto Starlink)                | 9    | Pendiente |           |
| RF-14 | Abstracción de proveedores + caché + fallback              | 3    | Pendiente |           |
| RF-15 | Modo validación vs N2YO / Where the ISS at? (error km)     | 10   | Pendiente |           |
| RF-16 | Antigüedad de datos orbitales + alerta de desactualización | 4    | Pendiente |           |

---

## Hito 0 — Inspección y diseño

- [x] Validar versión de React Native vigente y compatibilidad de cada lib nativa (empírica al compilar, como TP6): `satellite.js` 7.1.0 (**indicada por la cátedra**; JS puro, ESM, tipos TS incluidos — verificar resolución de `exports` en Metro), `react-native-maps` vs MapLibre React Native, almacenamiento (SQLite: op-sqlite / react-native-nitro-sqlite / AsyncStorage según volumen), `notifee`, `react-native-background-fetch`, `react-native-geolocation-service` vs `@react-native-community/geolocation`, `react-native-sensors`, `react-native-svg`
- [x] Matriz de librerías [V]/[A] con `npm view <pkg> version time.modified peerDependencies`
- [x] Crear `docs/ARCHITECTURE.md`: capas del enunciado (Data Provider, Orbital Engine, Observer, Prediction, Geo/Map, Validation, Presentation, Notification), modelo de datos, estrategia de pruebas, riesgos
- [x] Documentar decisiones ya tomadas (ver sección Decisiones) y riesgos: rendimiento de la capa constelación, límites de API, emulador sin GPS/magnetómetro físico, Doze/background en Android

**Aceptación:** arquitectura y dependencias justificadas; riesgos identificados; pasos de build definidos.

## Hito 1 — Base de la aplicación

- [ ] Proyecto React Native CLI + TypeScript estricto, solo Android (patrón TP6)
- [ ] Estructura de carpetas (`screens`, `components`, `domain`, `services`, `database`, `utils`, `types`)
- [ ] React Navigation: Mapa, Catálogo, Pases, Validación, Configuración (estados vacíos)
- [ ] Permisos en `AndroidManifest.xml`: INTERNET, ACCESS_FINE/COARSE_LOCATION, POST_NOTIFICATIONS (API 33+); runtime en contexto con cada feature
- [ ] Lint + `tsc` + jest configurados
- [ ] Generar APK debug (ruta corta del repo ya cumple; single-ABI si el build lo pide)

**Aceptación:** compila, genera APK y navega entre pantallas vacías en emulador.

## Hito 2 — Motor orbital (jest-first, sin dispositivo)

- [ ] Wrapper TS sobre satellite.js: `json2satrec` (OMM/JSON, **formato principal**) y `twoline2satrec` (TLE, fallback legacy)
- [ ] Propagación: ECI → ECF (`gstime`) → geodético lat/lon/alt (punto subsatelital)
- [ ] Look angles topocéntricos: az/el/rango respecto del observador
- [ ] **UTC end-to-end**: todo el dominio en UTC (epoch/Date), hora local solo en presentación
- [ ] Manejo de errores de propagación: `satrec.error` (Decayed, etc.) → errores tipados `ORBIT_*`
- [ ] Tests con fixtures offline (sin red): TLE/OMM de ISS de época fija vs valores de referencia; consistencia entre muestras consecutivas; satélite decaído

**Aceptación:** motor puro con tests verdes sin red ni dispositivo. RF-02 y RF-03 (cálculo) Implementados.

## Hito 3 — Capa de datos (proveedores, caché, fallback)

- [ ] Interfaz `DataProvider`: `getCatalog`, `getOrbitalData`, `getValidationPosition`
- [ ] `CelesTrakProvider`: catálogo GP en JSON/OMM + SupGP Starlink (`sup-gp.php?FILE=starlink&FORMAT=json`)
- [ ] Caché local con TTL 12-24 h + marca de antigüedad; operar sin conectividad
- [ ] Rate limiter por proveedor (límites verificados: N2YO 1000/h tle+positions y 100/h passes+above; WTIA ~1 req/s; Space-Track a confirmar **(humano)** con cuenta) + reintentos con backoff exponencial
- [ ] `WhereTheIssProvider`: `/tles` y `/positions?timestamps=` (validación por timestamp exacto)
- [ ] `N2yoProvider`: apiKey fuera del bundle — **(humano)** genera la key gratuita
- [ ] `SpaceTrackProvider` (fallback): identidad/contraseña — **(humano)**; sesión cookie; credenciales jamás en código ni logs
- [ ] Orquestador con fallback automático CelesTrak → Space-Track
- [ ] Tests offline con fixtures: parse OMM/SupGP, TTL vencido, rate limit, fallback entre proveedores

**Aceptación:** RF-14 Implementado; RF-09 (lógica TTL) Implementado; catálogo consultable offline desde caché.

## Hito 4 — Catálogo y búsqueda

- [ ] Listado del catálogo con búsqueda por nombre y NORAD ID
- [ ] Filtros por constelación/grupo (Starlink, ISS, GPS operacional, meteorológicos, etc.)
- [ ] Indicador de antigüedad del set orbital + alerta cuando supera el TTL (RF-16)
- [ ] Selección → detalle con NORAD ID, epoch, fuente y fecha de descarga

**Aceptación:** RF-01, RF-08, RF-16 Implementados (verificación en emulador).

## Hito 5 — Mapa (marcador, ground track, footprint)

- [ ] Mapa con marcador del satélite seleccionado, refresco 1-5 s calculado localmente (throttling del estado)
- [ ] Ground track pasado/futuro ±1 órbita, paso 30-60 s, corte del antimeridiano (dividir polilínea cuando la longitud salte >180°)
- [ ] Footprint: círculo según altitud y elevación mínima configurable
- [ ] Cálculo de posiciones en lote (sin Web Workers — no existen en RN nativo)

**Aceptación:** RF-10, RF-11, RF-12 Implementados; marcador en movimiento verificado en emulador.

## Hito 6 — Predicción de pases y sky chart

- [ ] Búsqueda AOS/LOS por refinamiento grueso → fino (paso grueso 30-60 s, refinado ~1 s), umbral de elevación mínima configurable
- [ ] Lista de próximos pases: AOS (az), máximo (el), LOS (az), duración
- [ ] Sky chart polar SVG (`react-native-svg`): círculos de elevación concéntricos, trayectoria del pase, posición actual
- [ ] Tests del algoritmo: pase conocido de ISS (fixture con época fija), objeto GEO visto/no visto según latitud del observador, umbral 0° vs 10°, satélite que no sale

**Aceptación:** RF-04, RF-05 Implementados; algoritmo con tests automatizados.

## Hito 7 — Observador (GPS) y modo brújula

- [ ] Ubicación del observador: lat/lon/alt con manejo de permiso rechazado, GPS apagado, sin señal
- [ ] Ubicación manual por formulario como fallback (necesario para emulador y validación reproducible)
- [ ] Az/el en vivo del satélite seleccionado con brújula de referencia (N/NE/E/...)
- [ ] Modo brújula: overlay con heading del magnetómetro (`react-native-sensors`); **declinación magnética** corregida (valor manual configurable; en Buenos Aires ≈ -10°) o error documentado

**Aceptación:** RF-03 Verificado en pantalla; RF-07 Implementado con declinación documentada. Magnetómetro físico: **(humano)** si se quiere probar real.

## Hito 8 — Notificaciones y background

- [ ] `notifee` (NO `react-native-push-notification`, deprecado): canal Android + permiso POST_NOTIFICATIONS en runtime
- [ ] Programar notificación N minutos antes del próximo pase (N configurable)
- [ ] `react-native-background-fetch`: recálculo de pases y refresh de sets orbitales vencidos
- [ ] Tests de la lógica de scheduling (la notificación real es manual)

**Aceptación:** RF-06, RF-09 Implementados; notificación disparada verificada **(humano)** en dispositivo/emulador.

## Hito 9 — Capa de constelación

- [ ] Múltiples satélites simultáneos (subconjunto de Starlink) con límite configurable de objetos (p. ej. 50-100) o selección por grupo
- [ ] Propagación en lote + actualización de estado con throttling; medir rendimiento (tiempo de frame / jank visible)
- [ ] Si el rendimiento no alcanza con el límite elegido: evaluar el build WASM (SIMD/pthreads, C++ de Vallado) que trae satellite.js 7.1.0 — verificar primero soporte WASM en Hermes; es techo de upgrade, no default
- [ ] Interacción limitada (solo el seleccionado tiene detalle) para proteger la UI

**Aceptación:** RF-13 Implementado; rendimiento medido sin degradación visible con el límite elegido.

## Hito 10 — Validación, matriz y cierre

- [ ] Modo validación A (error de implementación aislado): mismo TLE (WTIA `/tles`) propagado localmente vs posición WTIA en el **mismo timestamp** (`/positions?timestamps=`)
- [ ] Modo validación B (error total): posición local vs N2YO `/positions` (con su az/el para validar look angles)
- [ ] Tabla de errores en km con antigüedad del set orbital usado; exportación para el informe
- [ ] Informe de validación (entregable) + documento de decisiones de fuentes (justificación SupGP Starlink, límites, caché/fallback) + documento técnico (modelo de propagación, supuestos, limitaciones)
- [ ] Matriz de escenarios de prueba (A/M/R) en este archivo
- [ ] Recorrido E2E: catálogo → selección → mapa (marcador + track + footprint) → constelación → próximo pase + sky chart → notificación
- [ ] APK de prueba; video demo **(humano)**: ISS real-time, constelación Starlink, pase con sky chart, notificación

**Aceptación:** RF-15 Implementado; criterio de mayor peso (25%) cubierto con evidencia; entregables completos.

---

## Registro de hitos cerrados

_(el agente agrega aquí: fecha, resumen, archivos, dependencias nuevas, comandos de prueba, resultados, qué es real/simulado, limitaciones)_

### 2026-11-03 — Hito 0 (agente)

**Hito 0 — Implementado.** Entregable: `docs/ARCHITECTURE.md` (matriz [V]/[A], capas, modelo de datos, pruebas, riesgos, build).

- Comandos: `npm view <pkg> version time.modified peerDependencies` para react-native, react, satellite.js, react-native-maps, @maplibre/maplibre-react-native, @op-engineering/op-sqlite, async-storage, @notifee/react-native, react-native-background-fetch, react-native-geolocation-service, @react-native-community/geolocation, react-native-sensors, react-native-svg (2026-11-03).
- Elegido: **React Native 0.88.1** (latest 2026-11-02, misma línea que TP6 0.88.0) + react 19.3.1.
- Selección de libs: `react-native-maps` 1.29.11 (peers ≥0.76; MapLibre 11.5.1 viable pero descartada por peer de expo), `@op-engineering/op-sqlite` 19.0.3 (catálogo en MBs; AsyncStorage 3.1.1 solo prefs), `@notifee/react-native` 9.1.8, `react-native-svg` 15.16.0, `react-native-background-fetch` 4.4.2 ([R]: peer `@expo/config-plugins` ≥10 — validar si es opcional en install), `react-native-geolocation-service` 5.3.1 (**[V] por evidencia TP6**: verificada devolviendo coordenadas en RN 0.88/emulador el 2026-10-25, pese a no publicar desde 2022), `react-native-sensors` 7.3.6 ([R]: único magnetómetro RN CLI, sin publicar desde 2022; spike en Hito 7), `react-native-keychain` (compilado en TP6, para API key N2YO y credenciales Space-Track).
- Compatibilidad real de las libs nativas con RN 0.88.1/New Arch **NO verificada hasta compilar en su hito** (lección TP6). satellite.js 7.1.0 es ESM con `exports`: verificar Metro en Hito 1.
- Real vs simulado: solo diseño y datos de registry; nada compilado ni ejecutado todavía.
- Próximo: Hito 1 (base de la app).

## Decisiones y estado (2026-11-02)

- **Stack base fijado (Hito 0):** RN 0.88.1 + react 19.3.1, solo Android. Mapa: `react-native-maps` 1.29.11. Storage: `op-sqlite` 19.0.3 (catálogo/orbitales) + AsyncStorage (prefs). Notificaciones: `notifee` 9.1.8. GPS: `react-native-geolocation-service` 5.3.1 (evidencia TP6). SVG: `react-native-svg` 15.16.0. Secretos: `react-native-keychain`. Matriz completa con [V]/[A]/[R] en `docs/ARCHITECTURE.md` §1.
- **satellite.js es la lib del motor orbital indicada por la cátedra** (links provistos: GitHub `shashwatak/satellite-js` + paquete npm). Verificado 2026-11-03: **7.1.0** vigente, 3 maintainers, desarrollo activo, tipos TS incluidos, ESM (`exports`), soporta TLE (`twoline2satrec`) y OMM (`json2satrec`, "preferred for new applications"), y expone `gstime`, `eciToGeodetic`, `ecfToLookAngles`, `dopplerFactor` y sombreado. Trae además build WASM opcional (SIMD/pthreads) — cubierto como techo de rendimiento en Hito 9, no como default.
- **OMM/JSON es el formato principal de datos orbitales.** Los números de catálogo de 5 dígitos se agotaron el 2026-07-11 (SATCAT > 100000): todo objeto nuevo carece de TLE. `satellite.js` soporta OMM vía `json2satrec()` y su README lo marca "preferred for new applications". Un catálogo completo en TLE es imposible hoy.
- **notifee** para notificaciones; `react-native-push-notification` está deprecado.
- **UTC end-to-end** en el dominio (epoch TLE/OMM es UTC); hora local solo en la UI. Un desliz acá contamina todas las validaciones.
- **Sin Web Workers** (no existen en RN nativo): cómputo en lote + throttling, medido en Hito 9.
- **Validación metodológica** (Hito 10): mismo TLE + mismo timestamp para aislar el error del propagador del error de datos. WTIA expone ambos endpoints.
- **Declinación magnética** corregida o documentada en el modo brújula (~-10° en Buenos Aires).
- Límites verificados 2026-11-02: N2YO 1000/h (tle, positions) y 100/h (visualpasses, radiopasses, above), positions máx. 300 s por request, catálogos >100000 soportados (usar NORAD ID numérico, nunca Alpha-5); WTIA sin auth, ~1 req/s. Space-Track (<30 req/min, 300/h según enunciado) **sin verificar**: requiere cuenta **(humano)**.
- Entorno de prueba: emulador Android (como TP6, `Medium_Phone_API_36.1`); sin iPhone. La ruta `TP7` ya es corta (lección de build del TP6).
- Pendientes humano (cuando toque cada hito): cuenta Space-Track, API key N2YO, magnetómetro/GPS físicos, notificación real en dispositivo, video demo.
