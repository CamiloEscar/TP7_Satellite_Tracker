# Documento técnico — modelo de propagación (Satellite Tracker, TP7)

Documento entregable del Hito 10. Describe el modelo de propagación orbital y la matemática propia de la app (punto subsatelital, ángulos de mirada, búsqueda de pases, proyección del sky chart, radio de footprint), los supuestos del modelo y sus limitaciones. Complementa `docs/ARCHITECTURE.md` (capas y stack) y `docs/VALIDATION_REPORT.md` (evidencia de exactitud).

## 1. Modelo de propagación

| Aspecto                | Implementación                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teoría                 | **SGP4/SDP4** vía `satellite.js` 7.1.0 (librería indicada por la cátedra; JS puro, ESM, tipos TS incluidos). Los objetos de período > 225 min usan SDP4 a través del mismo `satrec`.                                                          |
| Ingesta de elementos   | **OMM/JSON como formato principal** (`json2satrec`): los NORAD ID ≥ 100000 (desde 2026-07-11) no tienen representación TLE. **TLE como fallback legacy** (`twoline2satrec`).                                                                  |
| Dominio temporal       | **UTC end-to-end** (epoch de TLE/OMM y propagación en UTC); la hora local se muestra solo en presentación.                                                                                                                                    |
| Errores de propagación | `satrec.error` se traduce a errores tipados `OrbitalError{code}`: `ORBIT_BAD_INPUT` (entrada malformada), `ORBIT_DECAYED` (objeto decaído), `ORBIT_PROPAGATION_FAILED`. Los errores crudos de la librería nunca cruzan la frontera del motor. |
| Marco de referencia    | Estado ECI (TEME) → ECF con `gstime` → geodético (lat/lon/alt).                                                                                                                                                                               |

API pública del motor (`src/orbital/engine.ts`): `createSatrecFromOmm` (principal), `createSatrecFromTle` (legacy), `getEpoch`, `subpointAt`, `lookAnglesAt`, `propagateEci` (exportado para quienes necesiten ambos por muestra sin duplicar propagaciones). Grados en la frontera, radianes internamente.

## 2. Matemática clave

### 2.1 Punto subsatelital (`subpointAt`)

Propagación SGP4 al instante pedido → estado ECI (TEME) → rotación a ECF con el tiempo sidéreo Greenwich (`gstime`) → `eciToGeodetic`: latitud, longitud y altitud geodéticas. La longitud se normaliza a (−180, 180].

### 2.2 Ángulos de mirada (`lookAnglesAt`)

Topocéntricos desde el observador (lat/lon/alt sobre el elipsoide WGS-84): azimut en [0, 360), elevación y distancia (km), vía `ecfToLookAngles`. RF-03.

### 2.3 Búsqueda de pases (`src/passes/passes.ts`)

1. **Escaneo grueso** de la ventana con paso de **30 s**, detectando cruces del umbral de elevación configurable (0/5/10/20°).
2. **Refinamiento por bisección** hasta ~1 s de precisión en AOS/LOS (`bisectCrossing`).
3. **Máximo** = argmax de muestras finas de 5 s + refinamiento con el vértice de la parábola por los vecinos del argmax (determinista, sin búsqueda dorada).
4. Semántica de borde: un pase en curso al inicio/fin de la ventana se reporta **recortado al borde**, no se descarta (sin esto, un GEO siempre visible no tendría cruces de umbral; fijado por test).
5. La trayectoria para el chart se acota a **256 muestras**.

### 2.4 Proyección del sky chart (`src/passes/skyChart.ts`)

Proyección polar: cenit en el centro, horizonte en el borde exterior de radio `R`; norte arriba, este a la derecha.

- Radio del anillo de elevación: `r = R · (90 − el) / 90` (0 en el cenit, `R` en el horizonte).
- Coordenadas: `x = r · sin(az)`, `y = −r · cos(az)`.

### 2.5 Ground track (`src/geo/track.ts`)

Muestreo de ±1 órbita con paso de 60 s (el período se deriva de `satrec.no`); la polilínea se divide cuando la longitud salta más de 180° entre muestras consecutivas (**corte del antimeridiano**). RF-11.

### 2.6 Footprint (`src/geo/track.ts`)

Radio angular del círculo de cobertura para una elevación mínima θ y altitud h:

```
β = acos((Re / (Re + h)) · cos θ) − θ
radio lineal = Re · β        con Re = 6371 km (radio terrestre medio)
```

El argumento del `acos` se acota a [−1, 1] y el resultado a ≥ 0 (entradas degeneradas). El polígono se construye con la fórmula de punto de destino (destination-point) a 64 vértices + cierre exacto, con longitudes envueltas a [−180, 180] para GeoJSON válido. La elevación mínima es configurable (chips 0/5/10/20°). RF-12.

### 2.7 Brújula y declinación magnética (`src/observer/compass.ts`)

- Rumbo magnético (marco Android del magnetómetro, supuesto de dispositivo plano): `atan2(−x, y)` normalizado a [0, 360).
- Corrección por declinación (positiva al este): `rumbo verdadero = (magnético + declinación + 360) % 360`.
- Declinación manual configurable (default **−10°**, Buenos Aires), rango validado −180..180.

### 2.8 Comparación para la validación (`src/validation/`)

- Distancia de superficie: **haversine** con radio medio terrestre 6371 km.
- Diferencias angulares (Δaz/Δel) normalizadas a [0, 180°].
- Regla mismo-timestamp: la propagación local se evalúa en el instante exacto de la muestra de referencia (ver `VALIDATION_REPORT.md` §2).

## 3. Supuestos del modelo

| Supuesto                                     | Detalle                                                                                                                                                                       | Consecuencia                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Tierra esférica para el footprint            | Re = 6371 km (radio medio); no se usa el elipsoide WGS-84 en la fórmula del footprint ni en el haversine                                                                      | Error de forma de la Tierra despreciable a la escala del footprint, pero es una aproximación |
| Observador sobre el elipsoide WGS-84         | lat/lon/alt geodéticos para look angles                                                                                                                                       | Coherente con el resto de la industria                                                       |
| Elementos orbitales como los sirve la fuente | Sin modelado de maniobras ni de arrastre atmosférico propio: la exactitud depende de la frescura del set (SGP4 modela arrastre simplificado dentro de sus supuestos clásicos) | La edad del set (RF-16) es parte de la interpretación del error                              |
| UTC end-to-end                               | Epoch y propagación en UTC; hora local solo en UI                                                                                                                             | Un desliz acá contamina todas las validaciones                                               |
| Declinación magnética manual                 | Valor configurado por el usuario (default −10° BA); sin modelo automático (p. ej. IGRF)                                                                                       | Error de rumbo acotado al valor cargado; documentado en la UI                                |
| Dispositivo plano para el magnetómetro       | Sin compensación de inclinación ni calibración de hierro blando/duro                                                                                                          | El rumbo degrada si el teléfono no está plano                                                |
| Timestamps de referencia                     | WTIA redondea a segundos; N2YO es now-forward con matching a 1 s ±1 s                                                                                                         | Ver limitaciones                                                                             |

## 4. Limitaciones

| #   | Limitación                                                                                                             | Estado / mitigación                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Hermes no soporta WASM**: el build WASM de satellite.js (SIMD/pthreads, C++ de Vallado) **no corre en Hermes**       | Queda como **techo documentado, nunca default**. Con los límites elegidos no hizo falta (ver #4). Evaluarlo de verdad exigiría otro runtime JS                                                                                                                     |
| 2   | **Sin Web Workers en React Native**                                                                                    | Propagación en lote a un timestamp compartido + throttling del estado (tick 2.5 s → throttle 5 s → lote → setState). Sin time-slicing (innecesario según las medidas)                                                                                              |
| 3   | La antigüedad del set degrada la exactitud de la propagación                                                           | TTL 12–24 h + auto-refresh en background (RF-09) + edad del set expuesta en UI y en la tabla de validación (RF-16)                                                                                                                                                 |
| 4   | **Las cifras de rendimiento son de jest/node, no de Hermes**                                                           | Mediana por lote: **2 ms (50 objetos)** y **3 ms (100 objetos)** en el harness (21 corridas, mediana; reloj de jest ~1 ms = techo); sonda node directa: ~0.15 ms (50) y ~0.35 ms (100), ~3–4 µs/objeto. El jank visible en emulador/dispositivo queda **(humano)** |
| 5   | Objetos siempre visibles (p. ej. GEO sobre el observador) escanean la ventana completa                                 | ~5760 propagaciones ≈ 140 ms medidos; acotado y tolerable, pero es el peor caso del algoritmo de pases                                                                                                                                                             |
| 6   | La trayectoria del sky chart se acota a 256 muestras                                                                   | Resolución suficiente para el chart; es un límite deliberado                                                                                                                                                                                                       |
| 7   | Polígonos de footprint que cruzan el antimeridiano o el círculo polar pueden renderizar con borde recto en MapLibre GL | Limitación del render; la geometría de `src/geo` está testeada por separado                                                                                                                                                                                        |
| 8   | Validación con 3 muestras reales (modo A); modo B sin corrida real                                                     | Ver `VALIDATION_REPORT.md` §5 **(humano)**                                                                                                                                                                                                                         |
| 9   | Settings (declinación, límite de constelación, minutos de aviso) en memoria, sin persistencia                          | No existe `app_settings` en `src/db/schema.ts`; upgrade path: tabla k/v de settings (anotado en el código)                                                                                                                                                         |

## 5. Trazabilidad de módulos

| Módulo                    | Responsabilidad                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `src/orbital/`            | Motor SGP4/SDP4: satrec desde OMM/TLE, propagación, subpoint, look angles, errores tipados |
| `src/passes/`             | Búsqueda AOS/LOS (grueso → bisección), máximo del pase, datos del sky chart                |
| `src/geo/`                | Ground track ±1 órbita, corte del antimeridiano, radio y polígono de footprint             |
| `src/validation/`         | Comparación vs fuentes de referencia, tabla de errores con edad del set, exports           |
| `src/constellation/`      | Subconjunto determinístico, propagación en lote + throttle                                 |
| `src/observer/`           | GPS/ubicación manual, magnetómetro + declinación                                           |
| `docs/ARCHITECTURE.md` §4 | Decisiones de dominio (formato, UTC, footprint, pases, rendimiento)                        |

## 6. Conclusión

- [x] Modelo de propagación documentado: SGP4/SDP4 vía satellite.js 7.1.0, ingesta OMM principal / TLE legacy, errores tipados.
- [x] Matemática propia documentada y testeada (subpoint, look angles, pases 30 s → bisección ~1 s, sky chart polar, footprint, brújula).
- [x] Supuestos explícitos (Tierra esférica para el footprint, declinación manual, UTC end-to-end, dispositivo plano).
- [x] Limitaciones honestas (WASM/Hermes como techo, sin Web Workers, edad del set, rendimiento medido en jest/node).
