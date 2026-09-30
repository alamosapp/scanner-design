# Detach: copias de paneles en ventanas propias

El botón **Detach** (`.icon-btn.detach-icon`) de cada panel abre una **copia en vivo** de ese panel en una ventana emergente propia, para ubicarla en cualquier parte de la pantalla o en otro monitor. Cada clic abre una copia más.

Paneles con detach: las 8 tablas (`.terminal[data-panel]`), incluida *Fast-Growing Momentum* con su constelación, y el panel de gráficos (`.chart-panel[data-panel="chart"]`).

## Uso

- Clic en Detach → se abre la copia. La primera vez tiene el tamaño del panel y aparece junto a él.
- La copia **recuerda su tamaño y posición** (por panel): la próxima copia de ese panel se abre donde quedó la última, también en otro monitor. Si se abren varias copias del mismo panel en una sesión, las siguientes se desplazan en cascada (28 px) para no quedar encimadas.
- **Otro monitor:** Chrome solo abre ventanas emergentes en otra pantalla si el sitio tiene el permiso *Administración de ventanas* ("Administrar ventanas en todas tus pantallas"). La primera vez que una copia debe abrirse en otro monitor, el navegador lo pide; al aceptarlo, la copia se mueve allí y desde entonces se abre directamente en su sitio. Si se rechaza, se abre en la pantalla de la principal y aparece un aviso (se puede habilitar luego en la configuración del sitio, icono junto a la URL).
- Si el navegador bloquea las ventanas emergentes, aparece un aviso para permitirlas.
- En teléfonos (≤ 720 px) el botón no se muestra.

## Comportamiento de la copia

| Aspecto | Comportamiento |
|---|---|
| Datos | Idénticos a la ventana principal: foto inicial + cada alerta y tick de precio en tiempo real. La copia no genera datos propios. |
| Constelación (Momentum) | Recibe el historial de calor y los halts, así que arranca igual que la principal. |
| Ajustes | Columnas, colores, exclusiones, filtros, tiers de float y sonidos se sincronizan entre todas las ventanas, se cambien donde se cambien. |
| Anchos de columna | **No** se sincronizan: las copias de un panel tienen sus propios anchos (`scanner:widths:v1:copy:<panel>`), porque suelen estar en otro monitor con otro espacio. |
| Sonido | Solo suena la ventana principal (sin duplicados). |
| Detach | La copia **no** tiene botón detach: solo la principal crea copias (sin anidado). |
| Vista | Siempre tabla de escritorio, aunque la ventana sea estrecha. Fullscreen disponible. |
| Recarga de la principal | Las copias se reconectan solas y reciben una foto nueva. |
| Cierre de la principal | Cada copia muestra "Scanner closed · waiting for it…" y se cierra a los 4 s si la principal no vuelve. |
| Gainers Open fuera de Market Open | La tabla no existe en Pre-Market, After Hours ni Closed. Una copia abierta **no se cierra**: se atenúa con el aviso "Gainers Open is off during … · back at the open" para que el usuario la cierre cuando quiera, y vuelve a la normalidad al abrir el mercado. La principal no ofrece Detach mientras la tabla está oculta. |

### Copia de Charts

- Arranca con el **ticker** y las **vistas/layout** de la principal y luego es independiente: cambiar ticker, pestaña o layout en la copia no afecta a la principal ni se guarda.
- **Bull vs. Bear** y **Key levels** llegan por el canal: el `snapshot` trae la serie del día de GXAI y cada lote nuevo llega como mensaje `bb`. Los dos gráficos usan el mismo feed. Se comparten con todas las ventanas la ventana visible y el botón `Price` de Bull vs. Bear (`scanner:bull-bear:v1`), y el intervalo, `S/R` y las alertas de Key levels (`scanner:key-levels:v1`). El zoom y el desplazamiento de Key levels son de cada ventana. Ver `BULL_BEAR.md` y `KEY_LEVELS.md`.
- El botón de **layout** (`.layout-icon`) aparece sin fullscreen cuando el panel mide **≥ 960 × 600 px**, y se oculta por debajo de **920 × 560 px** (40 px de margen para que no parpadee). El layout elegido se recuerda al achicar y volver a agrandar.

## Cómo funciona

La copia es la misma página cargada con `?detach=<panel>` (p. ej. `index.html?detach=momentum`, `?detach=chart`). Al detectarlo, `scanner.js` deja solo ese panel en la página (clase `is-detached` en `<html>`) y no monta el feed.

**Canal en vivo** — `BroadcastChannel("scanner:live")`, mensajes con `from` (id de ventana):

| Mensaje | Dirección | Contenido |
|---|---|---|
| `hello` | copia → principal | `panel` |
| `snapshot` | principal → copia (`to`) | Tablas: `rows` (+ `heat` en Momentum). Charts: `sym` y `bb` (serie del día de GXAI, para Bull vs. Bear y Key levels) |
| `alert` | principal → todas | `panel`, `row` |
| `quote` | principal → todas | `panel`, `sym`, `price` |
| `bb` | principal → todas | Bull vs. Bear y Key levels: `points` (con `vol` y `vwap` en las actualizaciones de Top List) y `alerts` nuevos, `halts`, `status`, `summary` |
| `ready` | principal → todas | al cargar: las copias sin enlace mandan `hello` |
| `bye` | principal → todas | al cerrar/recargar (`pagehide`) |

Una copia se enlaza con la primera principal que le responde e ignora a las demás.

**Sincronización de ajustes** — todo vive en `localStorage`; el evento `storage` recarga en las demás ventanas:
`scanner:columns:v2:<panel>`, `scanner:prefs:v1:<panel>`, `scanner:excluded:all`, `scanner:filters:v1`, `scanner:float:v1`, `scanner:sound:v1`, `scanner:bull-bear:v1`, `scanner:key-levels:v1`, `scanner:sound-files` (se actualiza cuando los audios personalizados ya están guardados en IndexedDB).

**Geometría** — `scanner:detach-geom:v1:<panel>` = `{ w, h, x, y }` (tamaño interior y posición en pantalla). La copia la guarda al redimensionar, al cerrarse y cada segundo (los navegadores no avisan cuando una ventana se mueve), pero **solo si se movió o cambió de tamaño desde que se abrió**: así una copia que el navegador dejó en otra pantalla no borra el sitio guardado. Si el sitio guardado no está en la pantalla actual, la principal llama a `getScreenDetails()` (Window Management API) antes de `window.open` y, con permiso, mueve la copia con `moveTo`/`resizeBy`.

## Código

En `scanner.js`:

- Sección **"Detached copies"**: `DETACHED`, `canDetach`, `openCopy`, `loadGeom`, `onThisScreen`/`placeOnScreen` (otro monitor), `serveCopies` (principal), `linkCopy` (copia).
- **Mount**: `TABLE_SETUP` (configuración de cada tabla) y el reparto principal/copia.
- `mountTable(..., { relay })` devuelve `{ push, quote, reset }`; en `tables` cada tabla tiene `reload()`.
- `mountConstellation` → `dump()` / `load()`.
- `mountChartPanel(root, { persist, adaptive })`: `persist: false` no guarda el layout; `adaptive` activa los layouts por tamaño (`CHART_ROOMY`).
- `createBullBearFeed()` (solo la principal) → `dump()` / `onUpdate()`; `mountBullBear()` y `mountKeyLevels()` → `load()` / `push()` / `reload()`.

En `styles.css`: reglas `.is-detached` y `.detach-status`.

## Limitaciones

- Con los datos simulados, si la ventana principal se minimiza mucho tiempo, Chrome ralentiza sus temporizadores y las copias se actualizan más lento. Con un feed real (websocket) no pasa.
- De los gráficos, Bull vs. Bear y Key levels tienen datos (simulados, un ticker). Rally tracker, cuando los tenga, debe enviarse por el mismo canal.
- Una copia abierta a mano como pestaña normal también guarda su geometría.
