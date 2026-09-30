# Account settings

**Account** y **Subscriptions** del menú de cuenta (`profile-menu`) abren un mismo diálogo (`#account-settings`) en esa pestaña. Es una adaptación del `settings-modal` de la landing (repo `alamosapp/new-scanner-landing-page`, `scanner.html`) al diseño del scanner, con sus superficies, líneas, tipografía y botones, y sin colores nuevos.

**Solo frontend.** No hay Google/Supabase ni Stripe: los datos son el mock `ACCOUNT` de `scanner.js`, en memoria (al recargar vuelve al inicio). La siguiente iteración reemplaza el mock por el backend.

```
Escritorio                                   Móvil (pantalla completa)
┌────────────┬──────────────────────────┐    ┌──────────────────────┐
│ SETTINGS   │ Account               ✕  │    │ Account           ✕  │
│ ▌Account   ├──────────────────────────┤    │ [Account|Subscript.] │  control segmentado
│  Subscr.   │ tarjetas y secciones     │    ├──────────────────────┤
│            │ (solo esto hace scroll)  │    │ tarjetas (scroll)    │
└────────────┴──────────────────────────┘    └──────────────────────┘
```

## Pestañas

| Account | Subscriptions |
|---|---|
| Perfil: avatar (tocarlo o **New design** dibuja un degradado nuevo), nombre y email | Plan: nombre, texto de estado y chip (**Active** verde / **Ending** ámbar) |
| Personal information: nombre editable; el email es el inicio de sesión y es de solo lectura | Transaction history: nombre, fecha, estado y monto |
| Session: **Log out** de este dispositivo | Billing information: email, nombre y dirección, con **Edit** |
| Danger zone: **Delete**, bloqueado mientras el plan se renueva, con un enlace a *Cancel your plan in Subscriptions* | Payment methods: tarjetas con **Add new**; el menú ⋯ de cada una tiene *Edit card*, *Set as default* y *Remove card* |
| | **Cancel plan** o, si ya está cancelado, **Resume plan** |

- **Escritorio**: pestañas laterales con ↑/↓ (también ←/→, Inicio y Fin). El título de la cabecera sigue a la pestaña.
- **Móvil**: pantalla completa respetando notch y barra de inicio, con un control segmentado de pulgar deslizante (como Table settings). Las filas se apilan: el texto arriba y el botón a todo el ancho (`--m-touch`). Las transacciones pasan a dos líneas.
- Cada apertura y cada cambio de pestaña empiezan arriba.

## Diálogos asociados

- **Confirmación compartida** (`#confirm-dialog`, `askConfirm` en `scanner.js`): Log out, Delete account, Cancel plan y Remove card. Cambian el título, el texto, la acción, el botón seguro (*Keep card*, *Keep plan*…) y el icono (`logout`, `warning`, `trash`). El foco empieza en la opción segura y al cerrar vuelve al botón que preguntó. Reemplaza al antiguo `#logout-confirm`.
- **Formularios** (`.form-modal`, `mountFormDialog`): *Edit billing information*, *Edit payment method* y *Add payment method*. Se abren sobre Account settings.
  - Save está apagado hasta que algo cambia.
  - Los errores aparecen en una línea roja bajo los campos; el campo afectado queda `aria-invalid` y con el foco.
  - Cancel, ✕, Esc o el fondo cierran el formulario y descartan el borrador.
  - En móvil son una hoja inferior alta.
- **Dirección** (`buildAddress`): país, líneas, código postal + ciudad y estado. Argentina usa su lista de provincias; cualquier otro país, un estado de texto libre. Solo el control visible está habilitado y se lee.
- **Tarjetas**: el número se agrupa de 4 en 4 y detecta la marca (Visa, MC, Amex, Discover), con validación Luhn; la fecha va como MM/YY. Estos campos sustituyen de momento a los campos seguros del proveedor de pago: del número solo se guardan la marca y los 4 últimos dígitos, y el formulario se vacía al cerrar.

## Comportamiento

- Cada cambio repinta todo lo que lo muestra (avatar de la nav y del menú, nombre, email, etiqueta del plan del menú y ambas pestañas) y lo confirma con un toast.
- Tras repintar una tarjeta, el foco vuelve a su botón ⋯ (o a *Add new* si ya no existe).
- **Menú ⋯**: se abre de uno en uno. Esc lo cierra sin cerrar el diálogo. Cerca del final del área con scroll se abre hacia arriba.
- **Log out** y **Delete account** emiten `scanner:logout` y `scanner:delete-account` en `document`, para que la capa de sesión los atienda.
- **Avatar**: iniciales con tinta oscura (`--avatar-ink`) sobre un degradado. Sin diseño propio usa `--grad-avatar`; *New design* elige dos colores vecinos de la paleta existente (`--green`, `--teal`, `--cyan`, `--violet`, `--pink`, `--orange`, `--amber`) y un ángulo, a partir de una semilla (`seeded`).
- Las copias (`?detach=`) no tienen menú de cuenta ni este diálogo.

## Tokens (`:root`)

`--avatar-xl`, `--avatar-ink`, `--acct-w`, `--acct-h`, `--acct-side-w`, `--acct-pad`, `--acct-gap`, `--acct-row-h`, `--form-w` y `--form-field-h` (48 px en móvil). No hay colores nuevos:
- Superficies y líneas de la paleta.
- `--pro` para lo activo.
- Rojo para lo que termina algo y ámbar para *Ending*.

## Pendiente (backend)

- Sesión real (nombre, email, avatar).
- Plan y facturas del proveedor de pago.
- Campos seguros de tarjeta en *Add payment method*.
- Enlaces de las facturas.
