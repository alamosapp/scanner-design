# Bull vs. Bear (quién domina el ticker)

Primera iteración del gráfico de la pestaña `Bull vs. Bear` del panel Charts, portado del repo [`stock_alert_dashboard`](https://github.com/alamosapp/stock_alert_dashboard) (`BULL_BEAR.md`). El objetivo de esta iteración es el **diseño** del gráfico: el algoritmo ya estaba validado allí y aquí corre en el navegador sobre **un solo ticker simulado (GXAI)**.

## Qué muestra

Una **puntuación de control** de −100 (vendedores) a +100 (compradores) y el **estado del momentum** (`Real conviction`, `Buyers taking over`, `Divergence detected`, …), a partir de tres evidencias con vida media de 2.5 min (el tiempo en Halt no cuenta):

| Evidencia | Peso | Cálculo |
| --- | --- | --- |
| Flujo de alertas `A` | 40 % | Alertas Buying/Selling Pressure con peso `log2(1 + Vol. 1m / 100)` (0.5–12); `A = tanh((compra − venta) / 16)` |
| Flujo de volumen `T` | 35 % | Volumen de cada lote repartido en compra/venta con `ndtr(r / σ)` (Bulk Volume Classification), neto frente al volumen habitual |
| Estructura de precio `P` | 25 % | Momentum de 3 min y distancia al VWAP, en sigmas |

`C = 100 × (0.40·A + 0.35·T + 0.25·P)`. Los estados se evalúan en el mismo orden y con los mismos umbrales que el original (Warming up → Divergence → Real conviction → Taking over → Fading → Holding → Tug of war → Quiet tape), con el antirrebote de 20 s: el estado vigente se mantiene mientras algún punto de los últimos 20 s lo respalde.

## Datos simulados

- `createBullBearFeed()` (sección **"Bull vs. Bear: mock feed"** de `scanner.js`) genera un día guionizado para GXAI con un **reloj simulado que marca 10:44 ET al abrir la página**: premarket tranquilo (08:50–09:30), impulso de apertura, Halt de 5 min (09:56–10:01), caída tras la reapertura, divergencia (precio sube con flujo vendedor), tug of war, un hueco de 3 min sin datos (punteado) y compradores de vuelta.
- Después sigue en vivo: un lote cada **5 s** (el CSV real manda uno cada ~15 s) y regímenes aleatorios cada 2–5 min. El precio y la variación del chart bar siguen a la serie.
- Con otro ticker en el buscador, el gráfico dice `Mock data covers GXAI only for now`.
- El mismo feed alimenta **Key levels** (ver `KEY_LEVELS.md`) y **Rally tracker** (ver `RALLY_TRACKER.md`): cada actualización de Top List lleva también su volumen (`vol`) y el VWAP (`vwap`), y Rally tracker usa además el control de cada punto y la participación.
- Solo la ventana principal corre el feed. Las copias (`?detach=chart`) reciben la serie en el `snapshot` y cada lote como mensaje `bb` (ver `DETACH.md`).

## Diseño (estilo TradingView)

- **Serie baseline**: línea de control verde sobre el cero y roja debajo, con un área en degradado que se desvanece hacia el cero. Escala fija −100…+100.
- **Banda ±25** gris muy tenue (nadie domina), grid a ±50/±100 y línea del cero sólida.
- **Alertas**: barras desde el cero (arriba Buying, abajo Selling), alto según su peso relativo a 12. Una barra por alerta, **sin agrupar**: una ráfaga se ve como un muro de barras, a propósito.
- **Precio**: línea gris neutra con escala propia (no es un color de señal). Se corta en Halts y huecos. Botón `Price`.
- **Halt**: sombreado, línea plana y salto en la reapertura, rótulo `HALT`. **Huecos** de más de 2 min: la línea sigue sólida, en gris neutro. **Premarket / after hours** sombreados.
- **Cinta de estados** bajo el gráfico: verde/rojo según el lado, ámbar para divergencia, gris sin lado; más intensa cuanto más claro el dominio.
- **Eje derecho**: `BULLS · +50 · 0 · −50 · BEARS`, tag del control (color del lado) y tag del precio (gris). **Eje de tiempo** en ET: `HH:MM`, o `HH:MM:SS` con marcas de menos de un minuto.
- **Marca de agua** del ticker, **último valor** con línea punteada y punto en vivo con halo.
- **Crosshair magnético**: se pega al punto más cercano, con chips en ambos ejes y una tarjeta con hora, sesión, estado, componentes, precio y alertas de ese instante. La tarjeta va junto al cursor, a su izquierda y centrada en su altura; pasa a la derecha cuando no cabe junto al borde izquierdo. Con teclado se centra en el punto.
- **Leyenda**: `Control` en gris sólido (la línea cambia de color según el lado), más gruesa que `Price`, como en el gráfico.
- **Cabecera**: píldora de estado + `since`, explicación, medidor `BEARS ━━┃━━ BULLS` (pista neutra; solo el lado que lidera toma color) y los componentes (`Alert flow`, `Buy volume`, `Price trend`, `Participation`, `Alerts 5m`), coloreados solo cuando tienen signo.

### Uso contenido del color

Solo verde (compradores) y rojo (vendedores) de la marca, ámbar únicamente para la divergencia y grises para todo lo demás (precio, Halt, rejilla, ejes, chips). El precio pasó de cian (original) a gris para no competir con la línea de control.

### Sin superposiciones

- Leyenda y controles están fuera del canvas, en su propia fila.
- Las etiquetas del eje ceden ante los tags y el chip del crosshair; los dos tags (control y precio) se separan entre sí y quedan dentro del área.
- Las marcas de tiempo se espacian según su ancho real y ceden ante el chip de hora.
- El rótulo `HALT` se coloca en el borde de la mitad libre y solo donde no pasa la línea, el precio, una barra ni la línea del último valor; si no cabe, no se dibuja.
- La tarjeta del crosshair nunca tapa la columna del crosshair: va a un lado del cursor y cambia de lado junto al borde izquierdo.

## Controles y accesibilidad

- `Price` y la ventana visible `1m`, `5m`, `15m`, `30m` (por defecto), `1h`, `Day`. El punto en vivo queda siempre en el borde derecho.
- Teclado sobre el canvas (enfocable): `←/→` mueve el crosshair un punto, `Shift` un minuto, `Home/End`, `Esc` lo quita. La tarjeta es `aria-live`; el canvas tiene un `aria-label` con estado, control y explicación; el medidor es `role="meter"` con `aria-valuetext`.
- `prefers-reduced-motion`: sin transición en el medidor.

## Tokens (`:root`, bloque Chart panel)

Colores: `--chart-bull`, `--chart-bear`, `--chart-warn`, `--chart-neutral`, `--chart-overlay` (precio), `--chart-zero`, `--chart-axis-text`, `--chart-crosshair`, `--chart-chip`, `--chart-ink`, `--chart-watermark`, `--chart-session`, `--chart-grid`, `--chart-bg`.
Intensidades (0–1): `--chart-area-a`, `--chart-bar-a`, `--chart-zone-a`, `--chart-overlay-a`, `--chart-session-a`, `--chart-halt-a`.
Geometría: `--chart-axis-w`, `--chart-axis-h`, `--chart-pad`, `--chart-live-pad`, `--chart-tag-h`, `--chart-band-h`, `--chart-band-gap`, `--chart-tip-w`. Las medidas se leen del contenedor del canvas, así un escenario estrecho (`@container chart-stage`) puede reducirlas.

## Persistencia

`localStorage`, clave `scanner:bull-bear:v1`: `{ "window": 1800000, "price": true }` (`window` en ms; `0` = día completo). Se recarga en el listener `storage`, así la principal y las copias comparten ventana y precio.

## Código

- `scanner.js`, sección **"Bull vs. Bear: mock feed"**: constantes `BB_*`, `ndtr`, `haltedIn`, `indexAt`, formateadores ET y `createBullBearFeed()` → `{ dump, onUpdate }`.
- `scanner.js`, sección **"Chart canvas helpers"**: colores de tokens, tags del eje (`spreadTags`) y la tarjeta junto al cursor (`placeChartTip`), compartidos con Key levels.
- `scanner.js`, sección **"Bull vs. Bear chart"**: `mountBullBear(view, root)` → `{ load, push, reload }`. Montaje y canal en la sección **Mount**.
- `index.html`: vista `#chart-view-bull-bear` con `.chart-canvas` (canvas, `.chart-tip`, `.chart-message`).
- `styles.css`: tokens `--chart-*`, `.chart-canvas`, `.chart-tip`, `.chart-message`, medidor dividido (`.chart-meter__fill`, `data-lead`).

## Pendiente / limitaciones

- Datos simulados de un solo ticker y reloj simulado; al conectar datos reales, el feed se sustituye por el endpoint (`/api/bull-bear`) y el mismo `load`/`push`.
- Sin panning ni zoom con la rueda: la ventana se elige con los botones.
- Los umbrales vienen del original; con datos reales conviene revisarlos.
