# Key levels (soportes y resistencias)

Primera iteración del gráfico de la pestaña `Key levels` del panel Charts, portado del repo [`stock_alert_dashboard`](https://github.com/alamosapp/stock_alert_dashboard) (`KEY_LEVELS.md` y `Real_Time_Alerts/key_levels.py`). El objetivo de esta iteración es el **diseño** del gráfico. El algoritmo ya estaba validado allí; aquí corre en el navegador sobre **un solo ticker simulado (GXAI)**.

## Qué muestra

El precio del ticker con hasta **3 resistencias** (por encima del último precio) y **3 soportes** (por debajo): los niveles más fuertes y más próximos al precio, cada uno en un precio psicológico redondo (`2.75`, `3.00`, `3.10`…). Además muestra el VWAP, el volumen y las alertas del día sobre la curva.

## Algoritmo (igual que el original)

1. **Rejilla**: el primer peldaño de `0.01 · 0.05 · 0.10 · 0.25 · 0.50 · 1 · 5 · 10 · 25 · 50 · 100 · 250 · 500` que sea mayor o igual que `max(1.5 % del precio, rango del día / 15)`.
2. **Volume profile**: el volumen de cada actualización se asigna al precio medio del tramo, con bins de ¼ de rejilla y un suavizado gaussiano (σ = 1.5 bins). De ahí salen el POC y los HVN (picos con prominencia ≥ 15 %). No se atribuye volumen si cambia la sesión o si el hueco supera 2 min. Sin volumen se usa el tiempo en precio.
3. **Swings**: máximos y mínimos del precio con prominencia `max(0.6 × rejilla, 4 % del rango)`, separados al menos 8 actualizaciones.
4. **Referencias**: High/Low del día, High/Low de cada sesión (si el día tiene más de una), Prev Close, Open, Close de la regular (en after hours) y el precio de cada alerta Buying/Selling Pressure.
5. **Ajuste al redondo**: cada candidato va al precio más redondo a menos de media rejilla. Si no hay ninguno, va al múltiplo más cercano de la rejilla.
6. **Puntuación**: volumen 3.0 · POC 1.5 · HVN 1.0 · cada toque 1.0 (máx. 4) · High/Low del día 1.5 · de sesión 1.2 · Prev Close 1.0 · Open 0.8 · Close 1.0 · cada alerta 0.6 (máx. 3) · redondez 0.35 por peldaño. Un nivel necesita **1.2** sin contar la redondez.
7. **Selección**: los niveles se ordenan por `puntuación × e^(−1.5 × distancia)` y se toman hasta 3 por lado, separados 1.5 rejillas. La fuerza va de 1 a 3 frente al más fuerte elegido: ≥ 75 % da 3 y ≥ 45 % da 2.

Hacen falta 20 actualizaciones para publicar niveles. NumPy y SciPy se sustituyen por equivalentes en JS: `findPeaks` replica `find_peaks` (mesetas, `distance`, `prominence`) y `gaussianSmooth` replica `gaussian_filter1d` (modo `constant`, truncado a 4σ). Los niveles se recalculan con cada actualización del feed (~1 ms).

## Datos simulados

- Es el **mismo día de GXAI que Bull vs. Bear** (`createBullBearFeed()`): cada actualización de Top List trae ahora también su volumen (`vol`) y el VWAP (`vwap`). Así los dos gráficos cuentan la misma historia: premarket, impulso de apertura, Halt, caída, hueco de 3 min y vuelta de los compradores.
- **Buying/Selling Pressure** son las alertas del feed. **Halt/Resume** salen de los Halts del feed.
- **New HoD** se deriva de la serie: un máximo del día en la sesión regular, como mucho cada 3 min (el mock no filtra alertas como un scanner real, y un triángulo por minuto saturaba el impulso).
- `Prev close` = 1.66 (el de la barra del chart). `Open` = primer precio de la sesión regular.
- Con otro ticker en el buscador, el gráfico dice `Mock data covers GXAI only for now`.

## Diseño (estilo TradingView)

- **Precio**: línea cian con un área en degradado que se desvanece hacia abajo (serie "Area" de TradingView). Una barra por intervalo (`15s`, `1m`, `5m`) con el último precio; el feed no tiene OHLC real, por eso no hay velas.
- **VWAP**: línea discontinua **gris**, no ámbar como en el original, para que no compita con los niveles.
- **Volumen**: panel propio bajo el precio, en gris. La barra es más clara si el precio subió en ese intervalo y más tenue si bajó; así se lee la dirección sin sumar colores. El eje muestra el volumen máximo del panel.
- **Niveles**: líneas finas a todo el ancho, **verde** para los soportes (donde defendieron los compradores) y **roja** para las resistencias (donde defendieron los vendedores). El violeta del original se descarta. La opacidad crece con la fuerza (0.30 · 0.45 · 0.60). El valor va **sobre la línea, en el borde derecho del gráfico** (`R 3.10`, `S 2.75`), no en el eje. Un nivel superado cambia de color al cambiar de lado.
- **Ancla en vivo**: la serie crece de izquierda a derecha hasta el borde izquierdo de la columna de valores; desde ahí la última barra queda fija y el historial se desplaza a la izquierda.
- **Escala**: el soporte y la resistencia más próximos entran en la escala si quedan a menos de medio rango del tramo visible. Los lejanos no aplastan la curva.
- **Alertas sobre la curva** (menú `Alerts`, selección múltiple con `Select all`):

  | Alerta | Marcador |
  | --- | --- |
  | New HoD | Triángulo blanco encima de la curva |
  | Buying Pressure | Punto verde sobre el precio, halo según `Vol. 1m` (escala del día) |
  | Selling Pressure | Punto rojo sobre el precio, halo según `Vol. 1m` |
  | Halt / Resume | Cuadrado gris (como el Halt de Bull vs. Bear) con `H` ámbar / `R` verde, fuera de la curva |

  Las alertas del mismo tipo en una barra se agrupan. La barra que contiene una alerta cierra en el precio de la alerta, para que el marcador quede sobre la curva; en la barra en vivo, una actualización llegada más de 15 s después vuelve a mandar.
- **Halt y huecos de más de 2 min**: el eje de tiempo los salta y el tramo que los une se dibuja en **gris**, como en Bull vs. Bear. **Premarket / after hours** van sombreados.
- **High / Low** del tramo visible, con una línea corta hasta la curva.
- **Eje derecho**: precios, tag del último precio (verde o rojo según el cambio del día), tag del VWAP (gris) y chip del crosshair. **Último precio** con línea punteada y punto en vivo con halo. **Marca de agua** del ticker.
- **Crosshair**: la vertical se pega a la barra y la horizontal sigue al cursor, con chip de precio (o de volumen, en su panel) y de hora. La tarjeta junto al cursor muestra hora, sesión, precio, cambio frente a la barra anterior, VWAP, volumen y las alertas de esa barra.
- **Leyenda**: `Price`, `VWAP`, `Volume`, `Support`, `Resistance` (los dos últimos se ocultan con `S/R` apagado).

### Cabecera (`chart-head`, como en los otros gráficos)

- **Píldora de estado** + `since`: dónde está el precio frente a sus niveles.

  | Estado | Tono | Cuándo |
  | --- | --- | --- |
  | `Breaking out` | verde | Cruzó hacia arriba un nivel en los últimos 5 min y sigue a menos de una rejilla por encima |
  | `Breaking down` | rojo | Cruzó hacia abajo un nivel en los últimos 5 min y sigue a menos de una rejilla por debajo |
  | `Testing resistance` / `Testing support` | gris | A menos de 0.35 rejillas del nivel más cercano |
  | `No resistance above` | verde | Por encima de todos los niveles |
  | `No support below` | rojo | Por debajo de todos los niveles |
  | `Between levels` | gris | Entre un soporte y una resistencia |
  | `Warming up` / `No clear levels` | gris | Menos de 20 actualizaciones, o ningún precio con evidencia suficiente |

  `since` se calcula recorriendo la serie hacia atrás con los niveles actuales (o es la hora del cruce en una ruptura).
- **Explicación**: distancias y el porqué del nivel, p. ej. `0.02 (0.7%) under resistance 3.10: strength 3/3 · 2 touches · day high`.
- **Medidor de rango** `S 3.00 ━━┃━━ R 3.10 0.9%`: el precio entre el soporte y la resistencia más próximos. El lado más cercano toma su color y la cifra es la distancia a ese nivel.
- **Stats**: `VWAP`, `VWAP slope` (regresión de 5 min, % por minuto, con signo), `High`, `Low`, `Open`, `Prev. close`.

### Uso contenido del color

Cian para la única serie de color (el precio), verde y rojo de la marca para los niveles y las alertas (compradores / vendedores), y grises para todo lo demás: VWAP, volumen, Halt/Resume, rejilla, ejes y chips. El ámbar se reserva para la `H` de Halt; New HoD va en blanco (`--chart-hod`), igual que en Rally tracker. Frente al original se quitan el ámbar del VWAP y el violeta de los soportes.

### Sin superposiciones

- Leyenda, controles y menú van fuera del canvas.
- Orden de colocación: marcadores (Halt/Resume, New HoD, Pressure por `Vol. 1m`) → rótulos High/Low (alargan su línea para esquivar marcadores) → valores de los niveles (se corren a la izquierda del rótulo con el que chocan). Lo que no cabe no se dibuja: los puntos esperan a un zoom y los triángulos y cuadrados se apilan fuera de la curva con una línea guía.
- Se dibuja en tres capas (puntos, guías, iconos), así ninguna guía cruza un icono.
- En el eje, las etiquetas de precio ceden ante los tags y el chip del crosshair, los tags se separan entre sí y la etiqueta de volumen cede ante el chip. Las marcas de tiempo se espacian según su ancho y ceden ante el chip de hora.
- La tarjeta va a un lado del cursor y cambia de lado junto al borde izquierdo.
- Si hay New HoD o Halt a la vista, la escala reserva sitio extra arriba y abajo, como mucho el 30 % del panel.

## Controles y accesibilidad

- `Alerts` (menú `role="menu"` con `menuitemcheckbox`; `↑/↓`, `Home/End`, `Esc`). Si no están todas marcadas, el botón muestra cuántas lo están.
- `S/R` (`aria-pressed`) muestra u oculta los niveles; la cabecera sigue informando de ellos.
- Intervalo `15s`, `1m` (por defecto), `5m`.
- **Rueda**: zoom anclado al cursor. **Arrastrar**, o `Shift` + rueda: desplazar. **Doble clic**: vuelta al vivo.
- **Teclado** sobre el canvas (enfocable): `←/→` barra a barra (`Shift`: 10), `Home` (primera visible), `End` (la última y en vivo), `+/−` zoom, `Esc` quita el crosshair. La tarjeta es `aria-live` y el canvas tiene un `aria-label` con el último precio, el VWAP y los niveles. El medidor es `role="meter"` con `aria-valuetext`.
- `prefers-reduced-motion`: sin animación del menú ni transición del medidor.

## Tokens (`:root`, bloque Chart panel)

Colores: `--chart-price` (cian), `--chart-vwap` (gris), `--chart-support` (= `--chart-bull`), `--chart-resistance` (= `--chart-bear`), `--chart-hod` (blanco, `--text`), `--chart-halt-ink` (ámbar), `--chart-resume-ink` (= `--chart-bull`), `--chart-volume` (gris). También reutiliza `--chart-neutral`, `--chart-chip`, `--chart-session`, `--chart-watermark` y los demás de Bull vs. Bear.
Intensidades: `--chart-price-area-a`, `--chart-vwap-a`, `--chart-level-a` + `--chart-level-step-a` (por fuerza), `--chart-volume-a` / `--chart-volume-down-a`.
Geometría: `--chart-bar-space` (px por barra antes del zoom), `--chart-vol-share` / `--chart-vol-max` (panel de volumen), `--chart-pane-sep`, `--chart-label-room`, `--chart-marker-room`.

## Persistencia

`localStorage`, clave `scanner:key-levels:v1`: `{ "interval": 60000, "levels": true, "alerts": ["hod", "buying", "selling", "halts"] }`. Se recarga en el listener `storage`, así la principal y las copias comparten intervalo, S/R y alertas. El zoom y el desplazamiento son de cada ventana.

## Código

- `scanner.js`, sección **"Chart canvas helpers"**: `chartColor`, `chartAlpha`, `crisp`, `spreadTags`, `placeChartTip`, compartidos con Bull vs. Bear.
- `scanner.js`, sección **"Key levels: support and resistance"**: `klGrid`, `klSnap`, `klRoundness`, `findPeaks`, `gaussianSmooth` y `computeKeyLevels(samples, refs, alerts)` → `{ price, step, levels }`. Cada nivel incluye `price`, `type`, `strength`, `score`, `touches`, `volumeShare`, `buying`, `selling` y `sources`, como el endpoint original.
- `scanner.js`, sección **"Key levels chart"**: `mountKeyLevels(view, root)` → `{ load, push, reload }`. Se monta y se alimenta en **Mount**, con el mismo feed que Bull vs. Bear.
- `index.html`: vista `#chart-view-key-levels` con `.chart-head`, `.chart-meter--range`, el menú `.chart-menu-list` y `.chart-canvas`.
- `styles.css`: tokens, `.chart-meter--range`, `.chart-pop`, `.chart-menu-list`, `.chart-check`, `.chart-mark`.

## Pendiente / limitaciones

- Datos simulados de un solo ticker y reloj simulado. Con datos reales, el feed se sustituye por `/api/ticker-history` + `/api/key-levels` (o se mantiene el cálculo en el navegador) con el mismo `load`/`push`.
- `since` usa los niveles actuales al recorrer la serie: si los niveles cambian, la hora de inicio puede moverse.
- Sin niveles de días anteriores.
