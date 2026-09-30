# Versión móvil

A ≤ 720 px, o en un teléfono en horizontal (`(max-height: 480px) and (pointer: coarse)`; `PHONE` en `scanner.js`, la misma consulta que el CSS), la ventana principal muestra **un panel a la vez**, elegido en una cinta de tabs. Es más ligera que el escritorio: sin table settings, filtros, sonidos, pantalla completa ni detach. Estilo tipo Robinhood/Webull: filas de borde a borde sobre el fondo de la página, blanco para lo seleccionado y color solo donde significa algo.

```
┌──────────────────────────┐
│ ▪ Scanner           (JL) │  nav: marca + cuenta
│ ● MARKET OPEN  10:42 ET  │  estado del mercado (fuera de la nav)
│ (Gainers) (Volume …) …   │  cinta de tabs, scroll horizontal
├──────────────────────────┤
│ panel elegido, a toda    │  toplists: tabla compacta
│ pantalla; solo su lista  │  alertas: tarjetas
│ hace scroll              │  momentum: constelación + tarjetas · charts: panel Charts
└──────────────────────────┘
```

## Shell

| Parte | Comportamiento |
|---|---|
| Nav | Solo `app-brand` y `profile`. Filtros, ayuda y pantalla completa se ocultan. |
| Estado | `mountPhone` mueve `.app-status` de la nav a `.m-bar` (bajo la nav) y la devuelve a la nav en anchos de escritorio. Hasta que el JS lo mueve, en móvil está oculto en la nav y su fila (y la de la cinta) ya está reservada en `.m-bar`: al cargar nada se solapa ni salta. La sesión y el reloj son `flex: none` (nunca se aprietan uno contra otro, tampoco en escritorio). |
| Pantalla | `.app` ocupa `100dvh`, con `safe-area-inset-*` (`viewport-fit=cover`). La página no hace scroll ni crece: `html`/`body` con `overflow: hidden` y `.app` con `position: relative; overflow: clip`, así cualquier pieza absoluta (p. ej. `.sr-only`) se resuelve dentro de `.app` y no ensancha el documento. Solo hace scroll la lista del panel. `theme-color` toma `--bg`. |
| Ayuda | El botón flotante desapareció: *User Guide* es un ítem del menú de cuenta (solo móvil). |

## Tabs

- Orden (`PHONE_TABS`): Gainers, Gainers Open, Volume Leaders, New HoD, Buying Pressure, Selling Pressure, Halts, Fast-Growing Momentum, Charts. Se generan desde el `data-title` de cada panel.
- **9 tabs en Market Open, 8 en Pre-Market / After Hours / Closed**: el tab de Gainers Open sigue a su panel (`syncSessionTables` → `phone.syncSession`). Si estaba abierto, se pasa a Gainers.
- Tab activo: píldora blanca (`--m-tab-on-bg`) con texto oscuro; el resto, `--m-tab-bg`. Al elegir uno se centra en la cinta (`scrollTo` absoluto, así dos cambios seguidos no se suman).
- El borde con más tabs detrás se desvanece (`data-more="start|end|both"` + `mask-image`).
- **Contador de nuevas alertas** en los tabs de alertas: cuenta las alertas que llegaron a pantalla (`onShown` de `mountTable`) desde que se abrió el tab por última vez, con el tono del panel (verde, rojo o ámbar). Solo cuenta en anchos de móvil; `99+` como máximo. Es un globo en la esquina de la píldora (`position: absolute`): un contador nuevo nunca cambia el ancho del tab, así la cinta no se desplaza bajo el dedo ni empuja fuera de vista el tab abierto (antes, con el contador en línea, Charts acababa fuera de la pantalla).
- Teclado: ←/→, Inicio y Fin cambian de tab (tabindex itinerante). En móvil cada panel es `role="tabpanel"` etiquetado por su tab; en escritorio recupera su `role="region"` / `aria-label`.
- Todos los paneles siguen montados y en vivo; el CSS oculta los que no tienen `[data-m-active]`.

## Paneles

| Panel | En móvil |
|---|---|
| Toplists (tablas de estado) | Siguen siendo **tabla** (no tarjetas). Columnas fijas por tabla (`PHONE_COLS`): Signal · Ticker · Price · su %Chg (Close u Open) · Volume · RVol · Float, con anchos `PHONE_W`. Se desliza en horizontal con Ticker fijo. Sin reordenar ni redimensionar; el orden y los anchos de escritorio no se tocan. |
| Alertas (New HoD, Buying, Selling, Halts) | Tarjetas: ticker + hora / Vol · RVol a la izquierda, precio / %Chg 1m (o timers del halt) a la derecha, franja de float a la izquierda. Píldora "N new" si llegan alertas con la lista desplazada. |
| Fast-Growing Momentum | Constelación arriba (`clamp(200px, 36dvh, 300px)`) y tarjetas debajo. |
| Charts | Panel completo; sin pantalla completa, layouts ni detach. Botón de **vista horizontal** (ver abajo). |

La barra del panel (`.terminal-bar`) se oculta: el tab ya lo nombra y sus herramientas son de escritorio.

## Vista horizontal del chart

Botón `[data-chart-rotate]` en la barra del panel Charts (solo móvil; las copias no lo tienen). El panel cubre la pantalla (`.is-landscape`, capa `--z-landscape`, por debajo de los diálogos) y el resto de la página queda `inert`.

- **Móvil en vertical**: el panel se gira 90° en sentido horario (`transform: rotate(90deg)`, `width: 100dvh; height: 100vw`); se lee girando el teléfono. El lado del notch acolcha su borde izquierdo.
- **Móvil en horizontal**: el panel simplemente llena la pantalla. Girar el teléfono con el tab Charts abierto **entra solo** y volver a vertical sale (solo si entró así; si se abrió con el botón, sigue girado).
- Sale con el mismo botón (✕), `Esc` o al pasar a anchos de escritorio.
- Los gráficos leen tamaño y puntero en su propio eje (`chartBox`, `chartPoint` en `scanner.js`): girado, `getBoundingClientRect` devuelve el rectángulo en pantalla (ancho y alto cruzados), así que x = `clientY − top` e y = `right − clientX`. Los canvas usan `touch-action: none` ahí: todo arrastre es del gráfico.
- Barras compactas (una línea cada una) para dejarle altura al trazado.

## Menú de cuenta

Hoja a todo el ancho bajo la nav: sin bordes curvos, letra más grande (`--m-menu-fs`, ítems de `--m-menu-item-h`) y fondo oscuro detrás (`.profile-scrim`, `--m-scrim`). Tocar el fondo lo cierra. Las flechas solo recorren los ítems visibles.

**Log out** (`.confirm-modal`): hoja inferior a todo el ancho, con título, texto y botones más grandes (`--m-touch`). **User Guide**: pantalla completa respetando notch y barra de inicio, texto de 15 px, cerrar y buscador de 44 px.

Los campos de texto (buscador de la guía, ticker del chart) van a **16 px** en móvil: por debajo, iOS amplía la página al enfocarlos y la deja más ancha que la pantalla.

## Detalles

- **Desbordes**: si algo ensancha el documento, el móvil aleja el zoom para mostrarlo (página negra a la derecha, scrollbars que aparecen y desaparecen, y los elementos `position: fixed` a todo el ancho —menú, guía, modal— se salen de la pantalla). La causa era el `.sr-only` de los contadores de los tabs: al no tener ancestro posicionado se resolvía contra `body`, fuera de la cinta. Ahora `.m-tab` y `.m-tabs` son `position: relative`, y `.app` recorta como red de seguridad.

- Animación de entrada (`rowIn`): la clase `is-new` se quita al terminar; si no, al volver a mostrar un tab el CSS repetía la animación en todas las tarjetas.
- Las copias (`?detach=`) **no** usan nada de esto: todas las reglas del shell llevan `html:not(.is-detached)` y siguen siendo la tabla de escritorio aunque la ventana sea estrecha.

## Tokens (`:root`)

`--m-gutter`, `--m-nav-h`, `--m-status-h`, `--m-tab-h`, `--m-tab-bg`, `--m-tab-ink`, `--m-tab-on-bg`, `--m-tab-on-ink`, `--m-badge-ink`, `--m-fade`, `--m-row-pad`, `--m-cell-h`, `--m-fs-sym`, `--m-fs-price`, `--m-fs-meta`, `--m-menu-fs`, `--m-menu-item-h`, `--m-touch`, `--m-avatar`, `--m-scrim`, y `--z-landscape` (capa de la vista horizontal). Todos derivan de la paleta existente: no hay colores nuevos.

## Almacenamiento

`scanner:phone-tab:v1`: último tab abierto en este dispositivo. Excepción deliberada a la regla del listener `storage`: las copias no tienen cinta de tabs, no hay nada que seguir.

## Probar en el móvil (ngrok)

```bash
cd tunnel && npm start
```

`tunnel/tunnel.mjs` sirve `scanner-design/` en `127.0.0.1:5179` y abre el túnel al dominio de `NGROK_DOMAIN` con `NGROK_TOKEN` (ambos en `scanner-design/.env`, que está en `.gitignore`). Usa su propio servidor estático porque `http-server` sirve dotfiles (`.env` con el token y `.git/` quedarían públicos): cualquier ruta con un segmento que empiece por `.` da 404. Sin caché, como `-c-1`. El plan gratuito de ngrok muestra un aviso la primera vez en cada navegador (*Visit Site*).
