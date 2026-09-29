# Fast-Growing Momentum: la constelación

El panel **Fast-Growing Momentum** muestra, encima de su tabla, una **constelación**: los tickers con alertas de momentum de los últimos 15 minutos dibujados en un canvas. **Cuanto más grande, brillante, cálido y cerca del centro, más momentum tiene ahora.**

## Qué muestra

- Solo los tickers que muestra la tabla de Momentum: respeta exclusiones y filtros activos.
- Como máximo **14** tickers (los de más calor); el resto se resume abajo a la derecha como `+N more`.
- Leyenda arriba: `Last 15m · closer to center = stronger`, y tres anillos punteados de referencia.
- Sin datos: "Waiting for momentum alerts..." o, si los filtros lo ocultan todo, "No rows match active filters".

## Calor (heat)

Cada alerta suma una **intensidad**:

| Columna | Mínimo del scanner | Peso |
|---|---|---|
| %Chg 1m | 2,5 % | 0,35 |
| %Chg 5m | 3 % | 0,30 |
| %Chg 15m | 5 % | 0,20 |
| %Chg 30m | 8 % | 0,15 |

- Por columna: `log2(1 + %Chg / mínimo)`, promediado con los pesos (1 = justo en el mínimo).
- Se multiplica por un factor de **Vol. 1m**: `1 + 0,2·log2(vol1m)`, limitado entre 0,8 y 1,5.
- Cada alerta **decae** con vida media de **4 minutos**; el calor del ticker es la suma.
- Un ticker sale **15 minutos** después de su última alerta, desvaneciéndose en el último 40 %.
- La escala sigue al líder (con un mínimo de 1,5 para que un ticker débil solitario no parezca líder).

## Estados

| Estado | Cuándo | En el canvas |
|---|---|---|
| Rising | alerta en el último minuto | triángulo junto al ticker |
| Momentum holding | entre 1 y 5 min sin alertas | — |
| Fading | más de 5 min sin alertas | color frío, se apaga |
| Halted | halt en curso | color cian, icono de pausa, `Halt mm:ss` debajo |
| Resumed | hasta 2 min tras reanudar | `Resumed mm:ss` debajo en verde |

Durante un **halt** el reloj se congela: no hay decaimiento ni expiración hasta que reanuda (el tiempo detenido no cuenta en la edad de las alertas).

Color: rampa `--heat-cool` → `--heat-warm` → `--heat-hot`; `--heat-halt` y `--heat-resume` para halts (tokens en `styles.css`).

## Posición y movimiento

- Cada ticker conserva el **ángulo** con el que llegó (ángulo áureo, para repartirse alrededor del centro); solo cambia su **distancia** al centro (`1 − fuerza`).
- Tamaño de fuente entre 11 px y hasta 44 px según fuerza y tamaño del panel.
- **Sin superposiciones**: cada cuadro se resuelve un layout sin choques partiendo del anterior (empuja por el eje de menor solapamiento, con histéresis para no oscilar; el más grande cede menos). La caja de cada ticker incluye su línea `Halt`/`Resumed`, y los que se están desvaneciendo son obstáculos fijos.
- **Densidad**: si no caben a su tamaño natural, todos se achican a la vez (hasta 40 %), rápido al achicar y lento al crecer.
- Las etiquetas se deslizan hacia su sitio con un resorte críticamente amortiguado (velocidad y aceleración limitadas) y se apartan entre sí en el camino. Nunca saltan.
- **Sin tirones**: el resorte apunta a una copia del sitio que lo sigue con 120 ms de retraso (`AIM_TAU`), y todo valor suavizado (fuerza, tamaño, partes) pasa por dos filtros seguidos (`lag2`). Así la velocidad crece y decrece gradualmente en vez de arrancar de golpe.
- **Un solo elemento**: icono de pausa, ticker, flecha de *Rising* y línea `Halt`/`Resumed` comparten una misma transformación (posición, balanceo y pulso). Cada parte entra y sale suavemente en 250 ms (`PART_TAU`): su hueco crece o se encoge con ella, así el texto se desliza en lugar de saltar, la línea inferior asoma desde debajo del ticker y el color pasa gradualmente a cian al entrar en halt.
- El ticker se dibuja a 100 px y se escala (`TEXT_REF`): el texto crece exactamente como su ancho medido, sin escalones de tamaño de fuente, así iconos y texto nunca se desalinean.
- Alerta nueva: pulso de brillo y crecimiento de hasta 15 % que sube rápido y baja lento, ambos suavizados (`pulseOf`). La caja crece con el pulso, así que tampoco se superpone. Balanceo decorativo de ±2,5 px, con el reloj del cuadro.
- Entrada y salida con fundido de 450 ms.
- `prefers-reduced-motion`: sin animación; se repinta una vez por segundo.

## Interacción

- **Hover**: resalta el ticker y muestra un tooltip con posición (`#n of N`), estado, última alerta, edad, alertas en 15 min, precio, cambio desde la primera alerta, %Chg por horizonte y Vol. 1m.
- **Clic**: selecciona o deselecciona el ticker (marco de color) y emite el evento `scanner:select` (`detail.sym`) para el panel de gráficos.
- Accesibilidad: el canvas tiene `role="img"` y un `aria-label` con los 5 más fuertes y su estado.

## Copias (detach)

La copia de Momentum recibe el historial de alertas y halts de la principal (`dump()`/`load()`), así que arranca con el mismo calor. Ver `DETACH.md`.

## Código

- `index.html`: `.constellation[data-constellation]` con el `<canvas>` y el tooltip dentro del panel Momentum.
- `scanner.js`, sección **"Momentum constellation"**:
  - Constantes `HEAT_*` (calor y estados) y de movimiento (`SPRING`, `MAX_SPEED`, `GAP`, `SUB_FONT`…).
  - `alertHeat` (intensidad de una alerta), `mountConstellation(root)` → `{ alert, halt, dump, load, … }`.
  - Dentro: `stateOf` (calor y estado), `measure` (caja y partes), `lag2`, `pulseOf`, `solve` (layout sin choques), `glide`/`repel` (movimiento), `drawBubble`, `updateTip`, `frame`.
  - Montaje: `TABLE_SETUP` conecta las alertas de Momentum (`alert`) y de Halts (`halt`).
- `styles.css`: tokens `--heat-*` y reglas `.constellation*`.
