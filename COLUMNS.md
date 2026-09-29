# Columnas: ancho ajustable

Cada tabla del scanner permite cambiar el ancho de sus columnas a mano. Los anchos se guardan **por tabla** y las copias (detach) tienen los suyos.

## Uso

- **Arrastrar**: el borde derecho de cada cabecera es un tirador (`.col-resize`). Al pasar el cursor por la cabecera aparece una línea fina; sobre el tirador toma el tono de la tabla. Mientras se arrastra, una guía (`.col-guide`) recorre la tabla entera.
- **Doble clic en el borde**: ajusta la columna a su contenido más ancho (cabecera y filas visibles).
- **Teclado**: con una cabecera enfocada, **Alt+Shift+←/→** cambia el ancho de 8 en 8 px. **Alt+←/→** sigue reordenando.
- **Reset widths**: en *Table settings → Columns*, junto a "Show all". Solo se activa si hay anchos cambiados y, como el resto del diálogo, se aplica al guardar. El **Reset** general del pie también restablece los anchos.

## Límites

| Columnas | Mínimo | Máximo |
|---|---|---|
| Chips de calor (%Chg 1m/5m/15m/30m, %Chg Close/Open, Vol. 1m, Hits) | 84 px (`HEAT_MIN`) | 360 px |
| Time | 84 px | 140 px |
| Ticker | 60 px | 140 px |
| Duration, Pressure, Trend | 64 px | 360 px |
| Resume | 80 px | 360 px |
| Resto | 56 px (`COL_MIN`) | 360 px (`COL_MAX`) |

**Signal** (`fixed: true`) no se puede ajustar. Todos los anchos se redondean a píxeles enteros.

## Comportamiento

| Aspecto | Comportamiento |
|---|---|
| Contenido estrecho | Las celdas (salvo Signal y Ticker) cortan con "…" en lugar de invadir la vecina. La barra de presión (`min(100px, 100%)`) y el sparkline (`min(88px, 100%)`, trazo `non-scaling-stroke`) se encogen con la columna. |
| Columnas fijadas | Signal (left 0) y Ticker (left `--pin-sym`) son *sticky*. Si Time se ensancha, Ticker se fija más tarde: `stickAt()` recalcula el punto con los anchos reales. |
| Alertas en vivo | Durante el arrastre solo cambian el `<col>` y el `min-width` de la tabla: las filas no se redibujan y las alertas siguen entrando. Un redibujado a mitad del gesto no lo corta (captura de puntero en la fila de cabecera). |
| Reordenar | El arrastre del borde cancela el `dragstart` de la columna, así no se mezcla con el drag & drop. |
| Guardado | Al soltar, y solo las columnas distintas del ancho por defecto (si no queda ninguna, se borra la clave). |
| Copias (detach) | **No** se sincronizan con la principal: cada copia suele estar en otro monitor con otro espacio. |

**Claves en `localStorage`**:
- Principal: `scanner:widths:v1:<panel>`
- Copias: `scanner:widths:v1:copy:<panel>`

Valor: `{ <columna>: <px> }`.

## Código

En `scanner.js`:

- **Columnas**: `COL_MIN`, `COL_MAX`, `HEAT_MIN`, `min`/`max`/`fixed` en cada columna, `clampWidth(key, w)`, `widthsKey(panel)`, `loadWidths` / `saveWidths`.
- **`mountTable`**:
  - `widths`, `widthOf`, `stickAt()`, `totalWidth()`, `syncStuck()`.
  - `setWidth(key, w)`, `showGuide`, `fitWidth(key)`: mide con Range la cabecera (+`GRIP_W` si es arrastrable) y las filas.
  - Eventos `pointerdown/move/up/cancel` y `lostpointercapture` en `headRow`, `dblclick` en el tirador y Alt+Shift en `keydown`.
  - `state()` / `apply()` de `tables` incluyen `widths`.
- **Table settings**: botón `[data-ts-reset-widths]` y `draft.widths` en la foto del diálogo.

En `styles.css`:

- Tokens en `:root`: `--col-handle-w` (área del tirador), `--col-handle-line` (grosor de la línea), `--col-handle-color` (color de la línea al pasar por la cabecera).
- Reglas `.col-resize`, `.col-guide`, `html.is-col-resizing` y `.scan-table[data-resizing]`.
