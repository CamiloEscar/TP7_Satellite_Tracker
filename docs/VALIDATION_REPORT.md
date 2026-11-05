# Informe de validación — Satellite Tracker (TP7)

Documento entregable del Hito 10 (RF-15, criterio de mayor peso: 25%). Presenta la metodología de validación del motor orbital contra fuentes independientes, los resultados medidos con evidencia real, su interpretación honesta y los pasos de reproducción. Fuentes complementarias: `SOURCE_DECISIONS.md` (decisiones de proveedores y límites) y `TECHNICAL_MODEL.md` (modelo de propagación, supuestos y limitaciones).

## 1. Objetivo

Validar que la posición del satélite calculada localmente con SGP4 (RF-02/RF-03) coincide con la de fuentes de referencia independientes (Where the ISS at? y N2YO), con el error expresado en kilómetros y acompañado de la antigüedad del set orbital usado (RF-16). El criterio RF-15 pide expresamente "Modo validación vs N2YO / Where the ISS at? (error km)".

La validación se implementó como capa pura (`src/validation/`) con dos modos complementarios que separan dos preguntas distintas:

| Modo                                    | Pregunta que responde                                                                             | Referencia                    | Conjunto orbital                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| **A** — error de implementación aislado | ¿nuestro código propaga igual que un propagador independiente cuando ambos parten del MISMO dato? | WTIA `/positions?timestamps=` | mismo TLE (WTIA `/tles`) en ambos lados      |
| **B** — error total                     | ¿qué error real ve el usuario frente a un servicio de referencia con datos propios?               | N2YO `/positions` (con az/el) | set propio (`getOrbitalData`) vs set de N2YO |

## 2. Metodología

### 2.1 Modo A — error de implementación aislado (WTIA)

1. Se descarga el TLE que WTIA sirve en ese instante (`GET /v1/satellites/25544/tles`).
2. Ese mismo TLE se propaga localmente con `satellite.js` (`createSatrecFromTle` → `subpointAt`).
3. Se consulta la posición de referencia de WTIA para el instante exacto de cada muestra (`GET /positions?timestamps=...`).
4. La diferencia se mide como distancia de superficie (haversine, R = 6371 km) y Δaltitud; Δaz/Δel no aplican (WTIA no aporta ángulos de mirada).

**Regla mismo-timestamp (crítica):** la propagación local se evalúa en el instante EXACTO de la muestra de referencia, nunca en el instante del request. WTIA redondea a segundos; propagar en el instante pedido contaminaría el resultado con hasta ~0.5 s de error temporal ≈ 3.8 km de error de superficie. La regla está fijada por test (`runValidation.test.ts`).

Restricción del modo: WTIA solo trackea la ISS (NORAD 25544); un NORAD distinto responde `ORBIT_BAD_INPUT` por diseño.

### 2.2 Modo B — error total (N2YO)

1. Se propaga localmente con el set propio de la app (vía `getOrbitalData`, con caché TTL y la antigüedad del set registrada por fila).
2. Se consultan las posiciones de N2YO (`GET /positions/{id}/...`, muestras now-forward: la primera es el UTC actual, una por segundo, máximo 300 s) desde el observador configurado.
3. El matching entre lados es a 1 s con tolerancia ±1 s (N2YO no admite timestamps pasados).
4. Además de la posición, se comparan los **ángulos de mirada**: `lookAnglesAt` local vs az/el que N2YO reporta desde el observador (Δaz/Δel, normalizados a [0, 180°]).

Este modo es el que mide el error total real: los sets orbitales son independientes (dos fuentes, dos épocas posibles) y los propagadores también.

### 2.3 Métricas y exportación

Por cada muestra: error de superficie (km), Δalt (km), Δaz/Δel (grados, solo modo B), timestamp UTC, epoch del set, fecha de descarga y **edad del set** (timestamp − epoch, en horas). El resumen agrega media y máximo. Los exports CSV y Markdown (`errorTableToCsv` / `errorTableToMarkdown`) son determinísticos y alimentan `docs/validation-evidence/`.

## 3. Resultados

### 3.1 Modo A — corrida real (2026-11-04)

Corrida en vivo contra WTIA el 2026-11-04 (22:48–22:50 UTC), un solo lote de 4 requests respetando ~1 req/s (1 × `/tles` + 3 × `/positions`). Set orbital: epoch `2026-11-03T22:01:52.916Z`, descargado `2026-11-04T22:48:28.716Z`.

| Timestamp (UTC)          | Error (km) | Δ alt (km) | Δ az (°) | Δ el (°) | Epoch set                | Descargado               | Edad set (h) |
| ------------------------ | ---------: | ---------: | -------: | -------: | ------------------------ | ------------------------ | -----------: |
| 2026-11-04T22:48:27.000Z |      0.000 |     −0.002 |        — |        — | 2026-11-03T22:01:52.916Z | 2026-11-04T22:48:28.716Z |        24.78 |
| 2026-11-04T22:49:27.000Z |      0.000 |     −0.002 |        — |        — | 2026-11-03T22:01:52.916Z | 2026-11-04T22:48:28.716Z |        24.79 |
| 2026-11-04T22:50:27.000Z |      0.000 |     −0.002 |        — |        — | 2026-11-03T22:01:52.916Z | 2026-11-04T22:48:28.716Z |        24.81 |

**Resumen:** 3 muestras · error medio 0.000 km · error máximo 0.000 km · Δaltitud medio −0.002 km.

- Muestras reales: **3** (corrida pequeña, acorde a la política de límites de la API).
- Resolución de exportación: 1 m (0.001 km); las diferencias sub-metro no se reflejan en la tabla.
- Evidencia completa (CSV + Markdown): `docs/validation-evidence/mode-a-live-2026-11-04.{csv,md}` (**real**).

### 3.2 Modo A — replay offline de fixtures (referencia complementaria)

Replay de los fixtures capturados en vivo el 2026-11-03, con la misma maquinaria y sin red (**simulado — fixtures**, etiquetado como tal en su export): 2 muestras, error de superficie 0.35–0.37 m, Δalt ≈ −1.93 m, edad del set ≈ 27.3 h. Export: `docs/validation-evidence/mode-a-fixtures-example.{csv,md}`. Este replay demuestra que el error observado es sub-metro incluso por debajo de la resolución del export.

### 3.3 Modo B — estado

Maquinaria completa implementada y testeada (`runValidation.test.ts`, `ValidationScreen.test.tsx`: error de maquinaria ≈ 0 con fuentes sintéticas). **La corrida real está pendiente (humano)**: requiere la API key de N2YO y el adapter Keychain del `SecretStore` (hoy devuelve `null` hasta que exista el adapter). Ver sección 5.

## 4. Interpretación

- **El error del modo A es ≈ 0.000 km (sub-metro) porque ambos caminos implementan la misma teoría.** WTIA propaga con SGP4 y nuestro camino usa `satellite.js` (SGP4/SDP4); con el mismo TLE y el mismo instante, la única diferencia posible es la implementación: unidades (rad/deg), manejo de UTC, transformación ECI→ECF con `gstime`, normalización de longitud y redondeos. El resultado sub-metro demuestra que esa diferencia es despreciable.
- **Por eso el modo A aísla el error de implementación y el modo B es la métrica significativa de error total.** El modo A no valida la teoría orbital ni la frescura de los datos (usa el mismo set en ambos lados); valida nuestro código. El modo B, con sets orbitales y propagadores independientes, es lo que el usuario experimenta y el número relevante para juzgar la exactitud de la app.
- La Δaltitud de ≈ −2 m observada es consistente con diferencias de redondeo entre implementaciones (WTIA redondea timestamps a segundos y sirve coordenadas redondeadas), no con un sesgo del modelo.
- La edad del set (24.8 h en la corrida real) queda registrada por fila: el error medido corresponde a un set de esa antigüedad, y RF-16 expone esa edad en la UI para que el usuario la interprete.

## 5. Limitaciones (honestas)

| #   | Limitación                                                                                                        | Impacto / estado                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | La corrida real del modo A tiene **3 muestras**                                                                   | Suficiente para el objetivo de aislamiento; ampliar solo consume requests según los límites por proveedor                                        |
| 2   | **Modo B sin corrida real**: falta la API key de N2YO y el adapter Keychain de `SecretStore` **(humano)**         | El adapter agrega un módulo nativo que exige un build para validarlo (regla del proyecto: validar libs nativas compilando; esta fase no compila) |
| 3   | Modo A limitado a la ISS (WTIA solo trackea NORAD 25544)                                                          | El modo B cubre el caso general                                                                                                                  |
| 4   | WTIA redondea timestamps a segundos; N2YO solo devuelve muestras now-forward (máx. 300 s, sin timestamps pasados) | Matching a 1 s con tolerancia ±1 s; no se pueden validar posiciones pasadas contra N2YO                                                          |
| 5   | Resolución de exportación: 1 m                                                                                    | Diferencias sub-metro aparecen como 0.000 km (el replay de fixtures documenta la magnitud real)                                                  |
| 6   | Timestamps en UTC end-to-end                                                                                      | Convención del dominio; la hora local se muestra solo en presentación                                                                            |

## 6. Reproducción

1. **Desde la app (ValidationScreen):** abrir la pantalla _Validación_ → seleccionar modo A o B → _Ejecutar_ → revisar la tabla de errores (error km, Δalt, Δaz/Δel, edad del set por fila) → _Exportar_ (CSV y Markdown). Los exports de la corrida real viven en `docs/validation-evidence/`.
2. **Corrida real del modo A (la del informe):** harness descartable compilado con `tsc` a CJS FUERA del repo, ejecutando el código real (`WtiaProvider` + `RateLimiter` + `runValidation`), jamás dentro de jest (la suite se mantiene 100% offline y determinista). Lote de 4 requests WTIA respetando ~1 req/s, timestamps al minuto: 22:48:27 / 22:49:27 / 22:50:27 UTC.
3. **Replay offline:** fixtures capturados en vivo el 2026-11-03 + misma maquinaria → `mode-a-fixtures-example.{csv,md}`.
4. **Tests de la maquinaria:** `npx jest` (baseline 287/287), incluyendo `src/validation/__tests__/` (32 tests: comparación, tabla, exports, `runValidation` con error de maquinaria ≈ 0 y replay de fixtures).

## 7. Trazabilidad

| Evidencia / código                                    | Ubicación                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Exports reales (modo A, corrida 2026-11-04)           | `docs/validation-evidence/mode-a-live-2026-11-04.{csv,md}`     |
| Exports de replay offline (fixtures 2026-11-03)       | `docs/validation-evidence/mode-a-fixtures-example.{csv,md}`    |
| Capa pura de validación                               | `src/validation/{compare,table,export,runValidation,index}.ts` |
| Tests de la maquinaria                                | `src/validation/__tests__/`                                    |
| Pantalla y exports desde la UI                        | `src/screens/ValidationScreen.tsx`                             |
| Proveedores usados (WTIA, N2YO)                       | `src/data/providers/{wheretheiss,n2yo}.ts`                     |
| Criterio RF-15 y matriz A/M/R (escenarios 15, 16, 22) | `docs/IMPLEMENTATION_PLAN.md`                                  |

## 8. Conclusión

- [x] RF-15 implementado con dos modos de validación (aislamiento de implementación + error total).
- [x] Evidencia **real** del modo A: 3 muestras, error 0.000 km (sub-metro), Δalt ≈ −2 m, antigüedad del set registrada por fila.
- [x] Maquinaria del modo B testeada (error ≈ 0 con fuentes sintéticas).
- [ ] Corrida real del modo B **(humano)**: API key N2YO + adapter Keychain.
- [ ] Ampliación de muestras y validación en dispositivo **(humano)**.
