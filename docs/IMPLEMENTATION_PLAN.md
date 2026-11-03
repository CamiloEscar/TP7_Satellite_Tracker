# Plan de implementación — Satellite Tracker (TP7)

Estados: `Pendiente` · `En progreso` · `Implementado` · `Verificado` (probado de verdad, con evidencia).

Forma de trabajo (heredada del TP6): un hito por sesión; este archivo es el único tracker; `Verificado` exige comando + salida registrada; distinguir siempre real vs simulado; conventional commits sin atribución de IA; no compilar tras cambios menores.

## Requisitos

| ID    | Requisito                                                  | Hito | Estado       | Evidencia                                                                                          |
| ----- | ---------------------------------------------------------- | ---- | ------------ | -------------------------------------------------------------------------------------------------- |
| RF-01 | Buscar/seleccionar satélites por nombre o NORAD ID         | 4    | Pendiente    |                                                                                                    |
| RF-02 | Posición actual (lat/lon/alt) vía SGP4 local               | 2, 5 | Implementado | Hito 2: `subpointAt`, 22 tests jest offline (TLE↔OMM <1 km, regression lock). Falta mapa (Hito 5). |
| RF-03 | Azimut/elevación respecto del observador                   | 2, 7 | Implementado | Hito 2: `lookAnglesAt` (grados en frontera; el≈90°/range≈alt testeado). Falta UI viva (Hito 7).    |
| RF-04 | Ventanas de visibilidad (AOS, máximo, LOS)                 | 6    | Pendiente    |                                                                                                    |
| RF-05 | Sky chart polar SVG                                        | 6    | Pendiente    |                                                                                                    |
| RF-06 | Notificación N minutos antes del pase                      | 8    | Pendiente    |                                                                                                    |
| RF-07 | Modo brújula (overlay de orientación)                      | 7    | Pendiente    |                                                                                                    |
| RF-08 | Filtrar catálogo por constelación                          | 4    | Pendiente    |                                                                                                    |
| RF-09 | Auto-refresh de datos orbitales por TTL (12-24 h)          | 3, 8 | Implementado | Hito 3: caché TTL 12-24 h + fallback stale (lógica). Falta auto-refresh background (Hito 8).       |
| RF-10 | Mapa con posición en tiempo real (refresco 1-5 s local)    | 5    | Pendiente    |                                                                                                    |
| RF-11 | Ground track ±1 órbita con corte de antimeridiano          | 5    | Pendiente    |                                                                                                    |
| RF-12 | Footprint según altitud y elevación mínima configurable    | 5    | Pendiente    |                                                                                                    |
| RF-13 | Capa de constelación (subconjunto Starlink)                | 9    | Pendiente    |                                                                                                    |
| RF-14 | Abstracción de proveedores + caché + fallback              | 3    | Implementado | Hito 3: `DataProvider` + 4 proveedores + orquestador con fallback; 44 tests offline.               |
| RF-15 | Modo validación vs N2YO / Where the ISS at? (error km)     | 10   | Pendiente    |                                                                                                    |
| RF-16 | Antigüedad de datos orbitales + alerta de desactualización | 4    | Pendiente    |                                                                                                    |

---

## Hito 0 — Inspección y diseño

- [x] Validar versión de React Native vigente y compatibilidad de cada lib nativa (empírica al compilar, como TP6): `satellite.js` 7.1.0 (**indicada por la cátedra**; JS puro, ESM, tipos TS incluidos — verificar resolución de `exports` en Metro), `react-native-maps` vs MapLibre React Native, almacenamiento (SQLite: op-sqlite / react-native-nitro-sqlite / AsyncStorage según volumen), `notifee`, `react-native-background-fetch`, `react-native-geolocation-service` vs `@react-native-community/geolocation`, `react-native-sensors`, `react-native-svg`
- [x] Matriz de librerías [V]/[A] con `npm view <pkg> version time.modified peerDependencies`
- [x] Crear `docs/ARCHITECTURE.md`: capas del enunciado (Data Provider, Orbital Engine, Observer, Prediction, Geo/Map, Validation, Presentation, Notification), modelo de datos, estrategia de pruebas, riesgos
- [x] Documentar decisiones ya tomadas (ver sección Decisiones) y riesgos: rendimiento de la capa constelación, límites de API, emulador sin GPS/magnetómetro físico, Doze/background en Android

**Aceptación:** arquitectura y dependencias justificadas; riesgos identificados; pasos de build definidos.

## Hito 1 — Base de la aplicación

- [x] Proyecto React Native CLI + TypeScript estricto, solo Android (patrón TP6)
- [x] Estructura de carpetas — mínima: `screens`, `components`, `navigation`, `types` (sin dirs vacíos de capas futuras; se crean en su hito)
- [x] React Navigation: Mapa, Catálogo, Pases, Validación, Configuración (estados vacíos) + Home como menú
- [x] Permisos en `AndroidManifest.xml`: INTERNET, ACCESS_FINE/COARSE_LOCATION, POST_NOTIFICATIONS (API 33+); runtime en contexto con cada feature
- [x] Lint + `tsc` + jest configurados
- [x] Generar APK debug (ruta corta del repo ya cumple; single-ABI si el build lo pide)

**Aceptación:** compila, genera APK y navega entre pantallas vacías en emulador.
**Estado:** **Verificado** (2026-11-03): build exitoso, permisos verificados con `aapt` sobre el APK, navegación Home → Catálogo probada en emulador `Medium_Phone_API_36.1` con uiautomator.

## Hito 2 — Motor orbital (jest-first, sin dispositivo)

- [x] Wrapper TS sobre satellite.js: `json2satrec` (OMM/JSON, **formato principal**) y `twoline2satrec` (TLE, fallback legacy)
- [x] Propagación: ECI → ECF (`gstime`) → geodético lat/lon/alt (punto subsatelital)
- [x] Look angles topocéntricos: az/el/rango respecto del observador
- [x] **UTC end-to-end**: todo el dominio en UTC (epoch/Date), hora local solo en presentación
- [x] Manejo de errores de propagación: `satrec.error` (Decayed, etc.) → errores tipados `ORBIT_*`
- [x] Tests con fixtures offline (sin red): TLE/OMM de ISS de época fija vs valores de referencia; consistencia entre muestras consecutivas; satélite decaído

**Aceptación:** motor puro con tests verdes sin red ni dispositivo. RF-02 y RF-03 (cálculo) Implementados.
**Estado:** **Verificado (tests)** (2026-11-03): jest 25/25 offline (22 del motor + 3 de app), equivalencia TLE↔OMM <1 km, regression lock congelado. Riesgo Metro/ESM del Hito 0 **retirado con evidencia** (bundle 74.758 bytes; la falla real fue el WASM opcional, no el ESM — ver registro).

## Hito 3 — Capa de datos (proveedores, caché, fallback)

- [x] Interfaz `DataProvider`: `getCatalog`, `getOrbitalData`, `getValidationPosition`
- [x] `CelesTrakProvider`: catálogo GP en JSON/OMM + SupGP Starlink (`sup-gp.php?FILE=starlink&FORMAT=json`)
- [x] Caché local con TTL 12-24 h + marca de antigüedad; operar sin conectividad
- [x] Rate limiter por proveedor (límites verificados: N2YO 1000/h tle+positions y 100/h passes+above; WTIA ~1 req/s; Space-Track a confirmar **(humano)** con cuenta) + reintentos con backoff exponencial
- [x] `WhereTheIssProvider`: `/tles` y `/positions?timestamps=` (validación por timestamp exacto)
- [x] `N2yoProvider`: apiKey fuera del bundle — **(humano)** genera la key gratuita
- [x] `SpaceTrackProvider` (fallback): identidad/contraseña — **(humano)**; sesión cookie; credenciales jamás en código ni logs
- [x] Orquestador con fallback automático CelesTrak → Space-Track
- [x] Tests offline con fixtures: parse OMM/SupGP, TTL vencido, rate limit, fallback entre proveedores

**Aceptación:** RF-14 Implementado; RF-09 (lógica TTL) Implementado; catálogo consultable offline desde caché.
**Estado:** **Verificado (tests)** (2026-11-03): jest 69/69 offline (44 nuevos de `data`), `eslint` + `tsc --noEmit` OK, assess riesgo **medium**. Pendiente empírico: build de op-sqlite y accesos vivos a APIs **(humano)** (ver registro).

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

### 2026-11-03 — Hito 1 (agente)

**Hito 1 — Implementado y Verificado en emulador.**

- Proyecto: `npx @react-native-community/cli@20.2.0 init SatelliteTracker --version 0.88.1 --package-name com.satellitetracker --skip-install` en temp, copiado a la raíz (sin `ios/` ni `Gemfile*`; `docs/` y enunciado intactos). react **19.3.0** (drift menor del template vs 19.3.1 de la matriz Hito 0 — sin impacto). Navigation: `@react-navigation/native` 7.5.1, `native-stack` 7.21.0, `react-native-screens` 4.30.1, `react-native-safe-area-context` 5.11.0.
- Archivos: `App.tsx`, `src/navigation/AppNavigator.tsx`, `src/screens/` x6 (Home + 5), `src/components/EmptyState.tsx`, `src/types/index.ts`, `jest.config.js`, `__tests__/App.test.tsx` (3 tests), manifest +4 permisos, script `typecheck`. Sin placeholders de capas futuras.
- Comandos y resultados: `npx eslint .` OK; `npx tsc --noEmit` OK (`"strict": true` confirmado); `npx jest` 3/3 pass; `.\gradlew.bat assembleDebug` BUILD SUCCESSFUL 4m07s (multi-ABI, APK 144,67 MB); rebuild `-PreactNativeArchitectures=x86_64` APK 46,42 MB (el multi-ABI no entraba en el emulador por espacio); `aapt dump permissions` → los 4 permisos presentes (+2 de debug RN, esperados).
- Emulador `Medium_Phone_API_36.1`: APK x86_64 instalado; `am start` + uiautomator dump → Home lista las 5 pantallas; tap en "Catálogo" → header + empty state "Sin satélites cargados todavía." Metro + `adb reverse` requeridos en debug (esperado). Navegación al resto usa el mismo mecanismo del stack (verificado el patrón representativo).
- Git: repo propio inicializado (`git init -b main`), 54 archivos staged, **0 commits** (humano decide).
- Real vs simulado: todo real (build, aapt, instalación, navegación). Sin feature logic por diseño del hito.
- Gotchas: (1) native-stack no monta children bajo react-test-renderer → el test de contenido renderiza `HomeScreen` con navigation falso; (2) `transformIgnorePatterns` debe EXTENDER el default del preset (pisarlo rompe el setup ESM de `@react-native/jest-preset`); (3) CLI no genera `android/local.properties` sin `ANDROID_HOME` → creado a mano (no versionado); (4) template genera dir cosmético `java/com/com.satellitetracker/` (segmento con punto; compila y corre, sin renombrar); (5) `am start` en vez de `monkey` para lanzar determinístico.
- Próximo: Hito 2 (motor orbital, jest-first).

### 2026-11-03 — Hito 2 (agente)

**Hito 2 — Implementado y Verificado (tests).** RF-02 y RF-03 (cálculo) Implementados.

- Dependencia: `satellite.js@7.1.0` exacta. Archivos: `src/orbital/{types.ts,engine.ts,index.ts}` + `src/orbital/__tests__/engine.test.ts` (22 tests); ajustes en `jest.config.js`, `babel.config.js`, `metro.config.js`.
- API pública (grados en la frontera, radianes internos): `createSatrecFromOmm` (principal), `createSatrecFromTle` (legacy), `getEpoch` (UTC desde `jdsatepoch`), `subpointAt` (lat/lon normalizado a (-180,180], alt km), `lookAnglesAt` (az [0,360), el, range km), `propagateEci` (exportado para tests/Hito 5). Errores tipados `OrbitalError{code}`: `ORBIT_BAD_INPUT | ORBIT_DECAYED | ORBIT_PROPAGATION_FAILED`.
- Comandos: `npm ls satellite.js` 7.1.0; `npx eslint .` OK; `npx tsc --noEmit` OK; `npx jest` **25/25** (2 suites); `npx react-native bundle --platform android --dev false` con entry descartable → **éxito, 74.758 bytes**, archivo temporario eliminado.
- Tests clave: sanity ISS (|lat|≤52, 400-460 km); muestreo 60 s × 1 órbita con velocidad ECI 7,6-7,7 km/s; **equivalencia TLE↔OMM <1 km** (helper de conversión campo a campo); `getEpoch` ±1 s de 2019-06-05T12:12:57.999883Z; look angles con observador en el subpunto (el≈90°, range≈alt) y observador desplazado; errores (malformado→BAD_INPUT, fallo real de runtime forzando `satrec.no` negativo, null+Decayed→DECAYED); **regression lock congelado** (lat 10.085278, lon 143.659462, alt 418.144820 a epoch+42 min).
- Real vs simulado: cómputo 100% real contra fixtures públicas embebidas (TLE ISS del README de satellite.js y ejemplo N2YO, OMM HELIOS 2A). Sin red. Correctitud numérica de SGP4 en sí = responsabilidad de la lib + validación del Hito 10.
- **Riesgo Metro/ESM retirado, con giro**: Metro resolvió el `exports` map sin problemas; la falla fue el **WASM opcional** (`dist/index.js` re-exporta `./wasm/index.js` que importa dinámicamente `#wasm-single-thread` → Metro intenta resolver `node:module`). Fix pre-autorizado por ARCHITECTURE.md §6: `resolveRequest` devuelve `{type:'empty'}` para los dos specifiers `#wasm-*` en `metro.config.js` (el WASM es el techo del Hito 9, nunca se ejecuta en nuestro camino).
- Gotchas jest+satellite.js: (1) el `exports` map **no tiene condición `require`/`default`** → jest no resuelve el bare specifier: `moduleNameMapper` → `dist/index.js`; (2) `dist/index.js` usa `export * as` que el preset de RN no transforma bajo jest → `@babel/plugin-transform-export-namespace-from` (ya venía como dependencia transitiva); (3) los exports ESM→CJS de babel no son configurables → `jest.spyOn` explota; usar `jest.mock` con factory + `requireActual`.
- Nota de diseño para Hito 5/6: `subpointAt` y `lookAnglesAt` propagan cada uno por su cuenta — quien necesite ambos por muestra debería usar `propagateEci` una vez y derivar. Revisar al medir rendimiento.
- Verificación delegada: assess medium + spot check propio (tsc 0, jest 25/25) + lectura de dominio del engine (rad/deg, UTC, normalización (-180,180], mapeo de errores) sin hallazgos.
- Próximo: Hito 3 (capa de datos).

### 2026-11-03 — Hito 3 (agente)

**Hito 3 — Implementado y Verificado (tests).** RF-14 Implementado; RF-09 (lógica TTL) Implementado.

- Dependencia: `@op-engineering/op-sqlite@19.0.3`. Archivos: `src/data/{types,memoryStore,cache,rateLimiter,orchestrator,index}.ts`, `src/data/providers/{shared,celestrak,wheretheiss,n2yo,spacetrack}.ts`, `src/db/{schema,opSqliteStore,index}.ts`; 5 suites nuevas en `src/data/__tests__/` + 6 fixtures JSON offline. 44 tests nuevos (69/69 total).
- API: `DataProvider` (`getCatalog`/`getOrbitalData`/`getValidationPosition`), `DataError` con códigos `DATA_*` (mismo patrón que `ORBIT_*`), puertos `CacheStore`/`SecretStore`/`HttpClient`/`Clock`. Caché TTL 12-24 h (default 24) con hit fresco sin red, refresco al vencer y servicio de datos vencidos (stale) cuando no hay conectividad; expone `fetchedAt`/`epoch`/`ageMs` (base de RF-16). Rate limiter sliding-window con los límites verificados del plan + `withRetry` (3 intentos, backoff exponencial, respeta `Retry-After`). Orquestador: CelesTrak → Space-Track (catálogo/órbita) y WTIA → N2YO (posición de validación); todos fallidos con caché vencida → la sirve marcada; sin caché → `DATA_ALL_PROVIDERS_FAILED`.
- Comandos: `npx eslint .` OK; `npx tsc --noEmit` OK (strict); `npx jest` **69/69** (7 suites: 25 baseline + 44 nuevas); `gentle-ai review assess` riesgo **medium** (único motivo: `configuration_change` por package-lock); spot check propio: jest re-ejecutado 69/69.
- Real vs simulado: código y tests reales; fixtures offline con formas reales de las APIs (OMM GP/SupGP de CelesTrak, WTIA `/tles` + `/positions` con valores en vivo, ejemplo oficial de N2YO, GP de Space-Track). Accesos vivos a APIs pendientes de API key N2YO y cuenta Space-Track **(humano)**: el plumbing está probado; la validación real es Hito 10.
- Diseño: inversión de dependencias — `data` define `CacheStore` y no importa `db`; el adaptador op-sqlite (fino: SQL + mapeo) se inyecta en el bootstrap de la app (próximos hitos); la lógica TTL/cache es 100% testeable con `memoryStore`.
- Gotchas: (1) fixtures `.json` y no `.ts` (jest trata todo `.ts` bajo `__tests__/` como suite); (2) URL de N2YO según docs oficiales (barra final antes de `&apiKey=`); (3) N2YO devuelve muestras now-forward → matching a 1 s con tolerancia ±1 s, mientras WTIA mantiene timestamp exacto; (4) Space-Track no tiene equivalente a `GROUP` de CelesTrak → el fallback de catálogo consulta payloads en órbita; (5) cookie de sesión de Space-Track delegada al cookie jar de la plataforma (upgrade path anotado con `ponytail:`).
- Pendiente empírico: compilación/autolink de op-sqlite (regla del proyecto: no compilar tras cambios) — validar en el próximo build (Hito 4+); adapter Keychain para `SecretStore` cuando una pantalla lo necesite (Hito 10).
- Próximo: Hito 4 (catálogo y búsqueda).

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
