# Decisiones de fuentes de datos — Satellite Tracker (TP7)

Documento entregable del Hito 10. Registra y justifica las decisiones de la capa de datos (RF-14): por qué se usa el SupGP de Starlink, el rol de cada proveedor, los límites de las APIs, el diseño de caché/fallback y rate limiter, la tolerancia a fallo parcial y los cuatro bugs reales de CelesTrak encontrados en la verificación del Hito 4. Todas las decisiones están tomadas de los registros de `IMPLEMENTATION_PLAN.md` (Hito 3, Hito 4, sección _Decisiones y estado_); no se documenta ninguna decisión sin respaldo registrado.

## 1. Resumen de decisiones

| Área                       | Decisión                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formato de datos orbitales | **OMM/JSON como formato principal** (`json2satrec`); TLE como fallback legacy (`twoline2satrec`). Los NORAD ID ≥ 100000 (desde 2026-07-11) no tienen representación TLE. |
| Catálogo                   | CelesTrak GP JSON por `GROUP` (stations, starlink, gps-ops, weather) → fallback Space-Track.                                                                             |
| Starlink                   | GP `GROUP=starlink` como base siempre disponible + **SupGP Starlink solo como enriquecimiento** cuando viene fresco.                                                     |
| Validación modo A          | WTIA (`/tles` + `/positions?timestamps=`), sin autenticación.                                                                                                            |
| Validación modo B          | N2YO (`/tle` + `/positions` con az/el); API key fuera del bundle **(humano)**.                                                                                           |
| Caché                      | TTL 12–24 h (default 24 h) + fallback _stale_ cuando no hay red; edad del set expuesta (RF-16).                                                                          |
| Rate limiting              | Sliding window por proveedor + reintentos con backoff exponencial (3 intentos, respeta `Retry-After`).                                                                   |
| Fallo parcial              | Una fuente caída no degrada el catálogo completo; se falla solo si TODAS fallan.                                                                                         |
| Secretos                   | Nunca en código ni logs; `SecretStore` con adapter Keychain **(humano)**.                                                                                                |

## 2. Proveedores y roles

| Proveedor                    | Rol en la app                                                      | Endpoints usados                                                                                        | Auth                                           | Límite operativo                                                                                  |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **CelesTrak**                | Fuente primaria de catálogo y sets orbitales (OMM/JSON)            | `gp.php?GROUP=...&FORMAT=json`; `supplemental/sup-gp.php?FILE=starlink&FORMAT=JSON`; `CATNR` por objeto | No                                             | Cada set grande: 1 descarga cada 2 h (403 con aviso de texto si se repite)                        |
| **Space-Track**              | Fallback de catálogo/órbita (orquestador CelesTrak → Space-Track)  | payloads GP en órbita (sin equivalente a `GROUP` de CelesTrak)                                          | Usuario/contraseña, sesión cookie **(humano)** | <30 req/min (y <300 req/h según enunciado); throttle exacto por cuenta sin confirmar **(humano)** |
| **WTIA** (Where the ISS at?) | Referencia del **modo A** de validación (ISS solamente)            | `/tles`; `/positions?timestamps=`                                                                       | No                                             | ~1 req/s                                                                                          |
| **N2YO**                     | Referencia del **modo B** de validación (posición + az/el) y pases | `/tle/{id}`; `/positions/{id}/...` (now-forward, máx. 300 s)                                            | API key (fuera del bundle) **(humano)**        | 1000 req/h (tle, positions); 100 req/h (visualpasses, radiopasses, above)                         |

Notas de diseño:

- El orquestador tiene dos cadenas separadas: **catálogo/órbita** (CelesTrak → Space-Track) y **posición de validación** (WTIA → N2YO). El dispatch de validación **no tiene fallback cruzado a propósito**: la identidad de la fuente (WTIA para A, N2YO para B) es parte de la evidencia.
- Space-Track no expone un equivalente al `GROUP` de CelesTrak: el fallback de catálogo consulta payloads en órbita.
- N2YO identifica objetos por NORAD ID numérico (nunca Alpha-5), y sus posiciones son now-forward (la primera muestra es el UTC actual): el matching de validación es a 1 s con tolerancia ±1 s.
- Límites verificados el 2026-11-02 contra la documentación oficial de cada servicio (N2YO confirma en su página de API: tle 1000, positions 1000, visualpasses/radiopasses/above 100, contados por hora).

## 3. Justificación del SupGP Starlink

CelesTrak publica para la constelación Starlink un set **suplemental** (SupGP) además del GP estándar. Las razones registradas para usarlo, y los límites que condicionan su uso:

1. **Enriquecimiento de la constelación más grande del catálogo.** Las filas de SupGP traen metadatos adicionales de Starlink y pueden aportar **varios elementos por objeto** (distintos epochs/fuentes), lo que permite quedarse con el set más fresco de cada objeto. Es el insumo natural para la capa de constelación (RF-13) y para los sets orbitales de Starlink.
2. **Endpoint corregido (bug real del Hito 4).** La URL `/NORAD/elements/sup-gp.php` devolvía **404**; la correcta es `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=JSON` (verificada 200, 5.1 MB, 2026-11-03). El provider quedó fijado a la URL verificada.
3. **Dedup multi-epoch.** SupGP puede devolver varios elementos por objeto (varios epochs/fuentes) → se conserva **solo el epoch más nuevo por NORAD ID** (`newestPerNoradId` en `src/data/providers/celestrak.ts`).
4. **Enriquecimiento, nunca base.** CelesTrak sirve cada `FILE` grande a lo sumo una vez cada 2 h y responde las repeticiones con **403 y aviso de texto** (no JSON). Por eso el GP `GROUP=starlink` es la base siempre disponible (con clasificación por `queryGroup`) y el SupGP solo enriquece cuando viene fresco. La caché TTL 12–24 h cumple el límite de 2 h con holgura.

## 4. Límites de las APIs

| Servicio    | Límite                                                                                   | Detalle registrado                                                                    |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| N2YO        | 1000 req/h para `tle` + `positions`; 100 req/h para `visualpasses`/`radiopasses`/`above` | `positions` máx. 300 s por request; identificar por NORAD ID numérico (nunca Alpha-5) |
| WTIA        | ~1 req/s, sin autenticación                                                              | Timestamps redondeados a segundos                                                     |
| CelesTrak   | 1 descarga cada 2 h por set grande (`FILE=starlink` de SupGP y `GROUP=starlink` de GP)   | Repetición dentro de la ventana → 403 con aviso de texto (encontrado en vivo, Hito 4) |
| Space-Track | <30 req/min (y <300 req/h según enunciado)                                               | **Sin verificar**: requiere cuenta **(humano)**                                       |

Estos límites se codifican como buckets del rate limiter (sección 6) y condicionan el diseño: las APIs se usan solo para datos orbitales (cada 12–24 h) y para validación; **toda posición se calcula localmente con SGP4**, nunca en cada frame.

## 5. Caché y fallback

| Mecanismo                  | Comportamiento                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTL                        | 12–24 h sobre `fetched_at` (default 24 h, acotado al rango; RF-09).                                                                                                                                             |
| Hit fresco                 | Se sirve sin red dentro del TTL.                                                                                                                                                                                |
| Refresco                   | Al vencer el TTL se descarga de nuevo por el camino normal.                                                                                                                                                     |
| Fallback _stale_           | Sin conectividad se sirve el set vencido, **marcado como tal**; sin caché en absoluto → `DATA_ALL_PROVIDERS_FAILED`.                                                                                            |
| Antigüedad                 | Cada registro expone `epoch` / `fetchedAt` / `ageMs`; la edad del set se muestra en UI (badge + alerta over-TTL, RF-16) y se exporta por fila en la tabla de validación.                                        |
| Fallback entre proveedores | Catálogo/órbita: CelesTrak → Space-Track. Validación: WTIA → N2YO (sin cruce, la fuente identifica el modo).                                                                                                    |
| Tolerancia a fallo parcial | Una fuente caída **no** tira abajo `getCatalog`: se usa lo disponible y se falla solo si TODAS las fuentes fallan (bug corregido en Hito 4; la tolerancia quedó demostrada en vivo frente al 403 de CelesTrak). |

Persistencia: `op-sqlite` (tablas `orbital_data` y `catalog_snapshot`, ver `docs/ARCHITECTURE.md` §3). Los secretos NO van a SQLite: la API key de N2YO y las credenciales de Space-Track van a Keychain **(humano)**.

## 6. Rate limiter y reintentos

- **Sliding window por bucket**, con el reloj inyectado (`Clock`) para que los tests no dependan de timers reales. Un pedido sobre el límite se rechaza de inmediato con `DATA_RATE_LIMITED`.
- Buckets por defecto (`src/data/rateLimiter.ts`):

| Bucket           | Ventana                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `n2yo-positions` | 1000 req / 1 h                                                   |
| `n2yo-passes`    | 100 req / 1 h                                                    |
| `wtia`           | 1 req / 1 s                                                      |
| `spacetrack`     | 30 req / 1 min (guía pública; confirmar por cuenta **(humano)**) |

- **Reintentos** (`withRetry`): 3 intentos con backoff exponencial, respetando `Retry-After` cuando el servidor lo envía. El rate limiter rechaza; el reintento lo decide el llamador.
- Errores tipados `DataError` con códigos `DATA_*` (sin red, sin credenciales, rate limit, parse, todos los proveedores fallidos): nunca se filtra la API key en mensajes ni en logs (cubierto por `secrets.test.ts`).

## 7. Los 4 bugs reales de CelesTrak (Hito 4)

Encontrados por la verificación en emulador con datos reales y corregidos con tests de regresión:

| #   | Bug                                     | Síntoma                                                                                | Corrección                                                                                                                                                                                 |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | URL de SupGP incorrecta                 | `/NORAD/elements/sup-gp.php` devolvía **404**                                          | Endpoint correcto `/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=JSON` (verificado 200, 5.1 MB)                                                                             |
| 2   | Fallo total ante una fuente caída       | Una sola fuente que fallaba tiraba abajo todo `getCatalog`                             | Tolerancia a fallo parcial: se falla solo si TODAS las fuentes fallan                                                                                                                      |
| 3   | Duplicados multi-epoch en SupGP         | Varios elementos por objeto (varios epochs/fuentes)                                    | Dedup conservando el epoch más nuevo por NORAD ID                                                                                                                                          |
| 4   | Rate limit de CelesTrak en sets grandes | Repetir la descarga dentro de la ventana responde **403 con aviso de texto** (no JSON) | GP `GROUP=starlink` como base siempre disponible (clasificación por `queryGroup`) + SupGP solo como enriquecimiento cuando viene fresco; la caché TTL 12–24 h cumple el límite con holgura |

## 8. Pendientes (humano)

- [ ] API key gratuita de N2YO (generarla desde la cuenta) y adapter Keychain de `SecretStore` (módulo nativo: exige un build para validarlo).
- [ ] Cuenta de Space-Track: credenciales y confirmación del throttle por cuenta.
- [ ] Re-check en vivo del chip Starlink y de la alerta over-TTL (ambos cubiertos por tests).

## 9. Trazabilidad

| Tema                                                                  | Registro fuente                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Límites verificados y decisiones de stack                             | `IMPLEMENTATION_PLAN.md` → _Decisiones y estado (2026-11-02)_ |
| Diseño de la capa de datos (providers, caché, rate limiter, fallback) | `IMPLEMENTATION_PLAN.md` → Hito 3                             |
| Los 4 bugs de CelesTrak y la verificación en vivo                     | `IMPLEMENTATION_PLAN.md` → Hito 4                             |
| Proveedores y modelo de datos                                         | `docs/ARCHITECTURE.md` §1, §3                                 |
| Validación (uso de WTIA/N2YO)                                         | `docs/VALIDATION_REPORT.md`                                   |
