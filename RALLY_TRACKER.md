# Rally tracker (repuntes acelerados)

Primera iteración del gráfico de la pestaña `Rally tracker` del panel Charts, portado del repo [`stock_alert_dashboard`](https://github.com/alamosapp/stock_alert_dashboard) (`RALLY_TRACKER.md` y `Real_Time_Alerts/rally_tracker.py`). El objetivo de esta iteración es el **diseño** del gráfico. El algoritmo ya estaba validado allí; aquí corre en el navegador sobre **un solo ticker simulado (GXAI)**.

## Qué responde

"¿Hay un repunte en marcha, cuánto lleva y se está acelerando o frenando?". Para el ticker:

- **Identifica** cada rally del día: un tramo de subida rápida frente al ruido del ticker.
- **Lo cuantifica**: ganancia en % y en centavos, duración, velocidad, volumen comprador y alertas.
- **Lo divide en tramos** (legs) separados por retrocesos y los clasifica: acelera, estable o desacelera.
- **Vigila la desaceleración** con siete señales y un estado (`Accelerating`, `Sustained buying`, `Decelerating`, `Stalling`, `Pullback`, …).
- **Da niveles**: zona de retroceso, precio de fallo y próxima resistencia de Key levels.

## Algoritmo (igual que el original)

1. **Puntos**: uno por actualización de Top List y uno por alerta con precio (New HoD, Buying/Selling Pressure), en orden de tiempo. A igual hora gana el precio de la alerta. El tiempo en Halt no cuenta (tiempo activo).
2. **Volatilidad** `σ` por 15 s (media exponencial de ~10 min) y volumen de cada actualización repartido entre compra y venta (Bulk Volume Classification), como en Bull vs. Bear.
3. **Umbrales** (retornos logarítmicos): tramo `max(0.8 %, 2 ticks, 2σ)`; inicio de un rally que tardó `d` en subir `max(1.5 %, 3 ticks, tramo, 2.5σ·√(d / 15 s))`, con `d ≥ 1 min`; caída mayor `max(3 %, 2 tramos, 2σ·√(10 min / 15 s))`.
4. **Inicio**: de los mínimos sucesivos de los últimos 10 min activos, gana el más bajo cuya subida cumple el umbral de su duración (la **base**). El inicio se corre al despegue: el último punto a menos de ¼ del umbral sobre la base.
5. **Tramos**: zigzag menor con el umbral de tramo. Un Resume que reabre en o por encima del último precio también abre uno. Cada tramo frente al anterior, por velocidad media: `Accelerating` ≥ 1.25×, `Decelerating` ≤ 0.8×, si no `Steady`; el primero es `Launch`.
6. **Fin**: caída desde el máximo de `max(tramo, min(61.8 % de lo ganado, caída mayor))` (`pullback`) o 10 min activos sin máximo nuevo (`stall`).
7. **Velocidad**: pendiente por mínimos cuadrados de `100·ln(precio)` en los últimos 2 min activos, en %/min. **Aceleración**: frente a la velocidad de 2 min antes, por encima de `max(25 %, 1.5σ)`. **Ritmo**: Theil-Sen del inicio al máximo.
8. **Estados** en orden de prioridad (`Halted`; con rally `Pullback`, `Stalling`, `Accelerating`, `Decelerating`, `Sustained buying`; sin rally `Warming up`, `Rally ended`, `Rally building`, `No rally`), con antirrebote de 20 s. La explicación usa el último punto que respaldó el estado.
9. **Señales de desaceleración**: `Speed fading`, `Weaker legs`, `Deeper pullbacks`, `No new high`, `Sellers active`, `Volume drying up`, `Extended from VWAP`, con los mismos umbrales del original.
10. **Niveles**: zona de retroceso 38.2–50 % del tramo en curso, `Fails <` = `máximo · e^(−umbral de fin)`, y la resistencia y el soporte de Key levels más próximos.

Cada estado se calcula solo con lo conocido hasta su hora, así la cinta de estados se ve igual que se vio en vivo. NumPy y SciPy se sustituyen por JS: la regresión usa sumas acumuladas, como el `cumsum` del original, y Theil-Sen es la mediana de las pendientes por pares.

**Rendimiento**: el día completo (~1.300 puntos) se recalcula en cada lote del feed, en ~20 ms en una máquina lenta. Solo se calcula con la vista a la vista; si está oculta, se marca como pendiente y se calcula al mostrarse. El ritmo (Theil-Sen, O(n²)) solo se calcula si se lee: la interfaz no lo muestra y el del rally activo cambia con cada máximo.

## Datos simulados

- Es el **mismo día de GXAI que Bull vs. Bear y Key levels** (`createBullBearFeed()`): Top List con precio, volumen y VWAP, alertas Buying/Selling Pressure, Halts y el control de Bull vs. Bear por punto.
- **New HoD** se deriva de la serie igual que en Key levels: un máximo del día en la sesión regular, como mucho cada 3 min.
- El mock no tiene alertas Fast-Growing Momentum. En el original alimentan el cálculo pero no se dibujan.
- La historia del día: un rally pequeño en premarket, el impulso de apertura (rally de ~25 %, con tramos que aceleran, se estabilizan y desaceleran), el Halt con el precio en el máximo, la caída que termina el rally (`pullback`), la divergencia y el tug of war sin rally, el hueco de 3 min y los compradores de vuelta con un rally activo. Después sigue en vivo.
- Con otro ticker en el buscador, el gráfico dice `Mock data covers GXAI only for now`.

## Diseño (estilo TradingView)

- **Dos paneles con un solo eje de tiempo**: ganancia arriba, velocidad debajo, la cinta de estados y el eje de tiempo abajo.
- **Bloques**: cada rally es un escalón que sube desde su base (0 %). Ancho = duración, alto = ganancia en %, así se comparan tickers de distinto precio. El relleno y el contorno siguen el **tramo**: verde intenso para `Launch` / `Accelerating`, verde tenue para `Steady`, ámbar para `Decelerating` y gris para el retroceso entre tramos. **Lo devuelto** desde el máximo se sombrea en **rojo** tenue. Al terminar, una línea gris baja hasta el 0 %.
- **Rótulo del rally** sobre su máximo: la ganancia (`+24.6%`) y encima el movimiento y la duración (`+61¢ · 25m 30s`; centavos por debajo de $1, dólares desde ahí).
- **Fuera de un rally**: una línea fina **gris** con la subida desde el mínimo de 10 min (más clara y gruesa en `Rally building`) y la línea discontinua `Rally trigger +X%` con lo que falta para iniciar uno. El turquesa del original se sustituye por gris.
- **Alertas sobre la curva**: New HoD (triángulo **blanco**, `--chart-hod`, como en Key levels), Buying Pressure (punto verde con halo) y Selling Pressure (punto rojo). Fuera de un rally se dibujan más tenues.
- **Niveles del rally activo** (botón `Levels`): zona de retroceso (banda **gris**, `Pullback zone 2.90–2.93`; turquesa en el original), `Fails < 2.95` (**rojo punteado**; naranja en el original) y la resistencia `R 3.10` (roja y fina, como en Key levels; solo si queda a menos de 1.5 veces el máximo visible, para no aplastar los bloques).
- **Panel de velocidad** (`SPEED %/MIN`): una línea **gris** de un solo tono, cortada en los Halts. El área sobre cero es gris y bajo cero **roja** (el precio cae). La línea punteada `Peak` es el pico del rally activo: la distancia hasta ella es la desaceleración a simple vista. No repite los colores de los tramos.
- **Halts** sombreados, con el chip `HALT` en el panel de velocidad. Con un Halt abierto, el eje llega hasta ahora y la pausa crece a la derecha. **Premarket / after hours** sombreados.
- **Cinta de estados**: verde intenso (`Accelerating`), verde (`Sustained buying`, tenue en `Rally building`), ámbar (`Decelerating`, `Stalling`), rojo (`Pullback`) y gris sin rally.
- **Eje derecho**: ganancia en % con pasos redondos y tag de la ganancia actual (color del estado); en el panel de velocidad, `max · 0 · min`, el tag de la velocidad actual (gris) y el del pico (chip). **Punto en vivo** con halo. **Marca de agua** del ticker.
- **Crosshair magnético** como en Bull vs. Bear: se pega al punto más cercano, marca también su velocidad y muestra chips de ganancia y hora. La tarjeta junto al cursor muestra hora, sesión, estado, precio, ganancia (o subida desde el mínimo), velocidad con ▲/▼, Bull vs. Bear, el rally y su tramo (`Rally 2 · leg 1: launch`, con base → máximo y cómo terminó) y las alertas de ese punto.
- **Leyenda**: `Accelerating`, `Steady`, `Decelerating`, `Pullback`, `Given back`.

### Cabecera (`chart-head`, como en los otros gráficos)

- **Píldora de estado** + `since`. Si pasan más de 2 min sin datos (y no hay Halt), se añade `no new data since HH:MM ET`.
- **Explicación**, p. ej. `Rally +10.9% in 12m 34s is speeding up: 1.1%/min, up from 0.6%/min 2 min ago.`
- **Medidor**:
  - `RALLY`: el precio entre la base del rally (izquierda) y su máximo (derecha). La pista a la derecha del cursor, teñida de rojo, es lo devuelto. El relleno es verde si el rally empuja y ámbar si desacelera, se estanca o retrocede.
  - `LAST`: lo mismo para el rally que acaba de terminar, en gris.
  - `RISE`: sin rally, la subida desde el mínimo hasta el umbral de inicio (la marca del extremo derecho).
- **Señales** (`FADE SIGNALS 2/7`): chips ámbar con las activas; `No signs of slowing` si no hay ninguna, `No rally to watch` sin rally. Las que no caben en una línea se resumen como `+N`. El `title` del grupo lista las siete con su detalle.
- **Métricas**:
  - Con rally: `Gain`, `Duration`, `Speed` (con pico), `From high`, `Buy flow`, `Volume`, `Next R` y `Fails <`.
  - Sin rally: `Rallies`, `Last rally`, `Off the low`, `Speed`, `Bull vs. Bear`, `Next R`, `Support`.
  - El `title` de cada una explica su cálculo.

### Uso contenido del color

Verde de la marca para los tramos que empujan (dos intensidades: acelera / estable), ámbar para la desaceleración (como en el original y en `--chart-decel`), rojo para lo que se pierde (lo devuelto, la velocidad negativa, `Fails <`, la resistencia) y grises para todo lo demás: retroceso entre tramos, subida fuera de un rally, umbral, zona de retroceso, velocidad, Halts, rejilla, ejes y chips. Frente al original se quitan el turquesa (rally en formación y zona de retroceso) y el naranja (fallo). New HoD va en blanco para no confundirse con el ámbar de la desaceleración.

### Sin superposiciones

- Leyenda y controles van fuera del canvas.
- Orden de colocación:
  1. **Marcadores**: New HoD primero, que sube por carriles si choca; luego Pressure por `Vol. 1m`, y un punto que choca no se dibuja.
  2. **Rótulos de los rallies**: el activo primero; sobre el máximo, subiendo hasta tres carriles, y si no cabe a su izquierda o a su derecha. Esquivan marcadores, la curva, las líneas de nivel y el punto en vivo.
  3. **Valores de los niveles**: en el borde derecho, sobre o bajo su línea, y se corren a la izquierda de lo que encuentren.
- Lo que no cabe no se dibuja.
- En el panel de velocidad, el título va arriba a la izquierda (abajo si pasa la línea), `Peak` junto a su línea (derecha o izquierda, arriba o abajo) y `HALT` solo si la pausa es lo bastante ancha. Ninguno pisa la línea de velocidad ni a los demás.
- En el eje, las etiquetas ceden ante los tags y el chip del crosshair; los tags de velocidad se separan entre sí, y el del pico se omite si el panel es muy bajo para los dos. Las marcas de tiempo se espacian según su ancho y ceden ante el chip de hora.
- La tarjeta va a un lado del cursor y cambia de lado junto al borde izquierdo.

## Controles y accesibilidad

- `Levels` (`aria-pressed`) muestra u oculta los niveles del rally activo. Sin rally activo se deshabilita, sin cambiar la preferencia guardada.
- Ventana visible `1m`, `5m`, `15m`, `30m`, `1h` (por defecto) y `Day`. El punto en vivo queda siempre en el borde derecho.
- **Teclado** sobre el canvas (enfocable): `←/→` punto a punto, `Shift` un minuto, `Home/End`, `Esc` quita el crosshair. La tarjeta es `aria-live`; el canvas tiene un `aria-label` con el estado, el rally y la explicación. El medidor es `role="meter"` con `aria-valuetext`.
- `prefers-reduced-motion`: sin transición en el medidor.

## Tokens (`:root`, bloque Chart panel)

Colores nuevos: `--chart-giveback` y `--chart-fail` (= `--chart-bear`), `--chart-zone`, `--chart-building` y `--chart-speed` (gris claro, `--text-2`), `--chart-rise` (= `--chart-neutral`). Reutiliza `--chart-accel`, `--chart-steady`, `--chart-decel`, `--chart-pullback`, `--chart-hod`, `--chart-resistance` y los comunes del panel.
Intensidades: `--chart-block-a`, `--chart-block-steady-a`, `--chart-block-pullback-a`, `--chart-giveback-a`, `--chart-pullzone-a`, `--chart-speed-a`, `--chart-speed-down-a`, `--chart-off-rally-a`.
Geometría: `--chart-rally-room` (sitio para el rótulo sobre el bloque más alto), `--chart-speed-share` / `--chart-speed-max` (panel de velocidad), más `--chart-pane-sep`, `--chart-band-h` y los ejes comunes.

Se eliminan los andamios `.chart-slots` / `.plot-slot` y sus tokens (`--chart-slot`, `--chart-sub-h`, `--chart-ribbon-h`, `--chart-grid-cell`): Rally tracker era la última vista que los usaba.

## Persistencia

`localStorage`, clave `scanner:rally-tracker:v1`: `{ "window": 3600000, "levels": true }` (`window` en ms; `0` = día completo). Se recarga en el listener `storage`, así la principal y las copias comparten ventana y `Levels`.

## Código

- `scanner.js`, sección **"Rally tracker: rallies, legs and states"**: constantes `RT_*`, `rtThresholds`, `rtStartAt`, `theilSen`, `rtDescribe` y `computeRallies({ samples, marks, halts, control, participation, levels })` → `{ points, rallies, alerts, halts, status, signals, summary }`, con los mismos campos que el endpoint original en camelCase. Cada punto trae además su tramo (`leg`) y la clase de su segmento (`segment`).
- `scanner.js`, sección **"Rally tracker chart"**: `mountRallyTracker(view, root)` → `{ load, push, reload }`. Usa `computeKeyLevels` para `Next R` / `Support` y los helpers de **"Chart canvas helpers"**. Se monta y se alimenta en **Mount**, con el mismo feed que Bull vs. Bear y Key levels.
- `index.html`: vista `#chart-view-rally` con `.chart-head`, `.chart-meter--rally`, `.chart-signals`, controles `data-rt-levels` / `data-rt-window` y `.chart-canvas`.
- `styles.css`: tokens, `.chart-meter--rally`, `.chart-signal[hidden]` (plegado `+N`), `.chart-tip__rally`, la clave `giveback` de la leyenda y los botones deshabilitados de `.chart-seg`.

## Pendiente / limitaciones

- Datos simulados de un solo ticker y reloj simulado. Con datos reales, el feed se sustituye por `/api/rally-tracker` (o se mantiene el cálculo en el navegador) con el mismo `load`/`push`.
- Sin alertas Fast-Growing Momentum en el mock.
- Sin panning ni zoom con la rueda: la ventana se elige con los botones, como en Bull vs. Bear.
- La estructura (inicio, máximo y tramos) se fija con lo que se sabe ahora, como en el original; los estados sí son causales.
