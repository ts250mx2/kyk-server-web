# KYK Server Web

Nuevo panel de reportes y pantallas de tienda, basado en la tecnología y conexiones de **kyk-dashboard** (Next.js 16, React 19, Tailwind 4, TypeScript).

## Login

- Captura **tienda** (drilldown), **usuario** y **contraseña**.
- El drilldown de tiendas se llena desde **BDKYKRemoto** (MySQL central):

```sql
SELECT A.*, B.DireccionMySql, B.BaseDatosMySQL, B.UsuarioMySQL, B.PasswdMySQL
FROM tblTiendasReportes A
INNER JOIN tblTiendas B ON A.IdTienda = B.IdTienda
WHERE A.IdRazonSocial IN (3,8)
ORDER BY Tienda
```

- Las credenciales se validan contra `tblUsuarios` en SQL Server (BDKYK), igual que kyk-dashboard.
- Al iniciar sesión se establece y verifica la conexión al servidor **MySQL de la tienda** seleccionada
  (`DireccionMySql` → host, `BaseDatosMySQL` → base de datos, `UsuarioMySQL` → usuario, `PasswdMySQL` → password).
- Los reportes deben consultar el MySQL de la tienda con `tiendaQuery(idTienda, sql, params)` de
  [src/lib/tienda-db.ts](src/lib/tienda-db.ts). Las credenciales MySQL de la tienda nunca viajan al navegador
  ni van dentro del JWT.

## Dashboard

Estructura igual que kyk-dashboard (Header fijo + Sidebar colapsable), en el tema oscuro del proyecto.

- **Principal** (`/dashboard`): movimientos del **día actual** de la tienda conectada (según el reloj
  del servidor MySQL de la tienda), con auto-refresco cada 60 s:
  - Ventas del día (`tblVentas`): total, tickets, ticket promedio y gráfica de ventas por hora.
  - Recibos del día (`tblReciboMovil`, Status=0): total, devoluciones y detalle con proveedor.
  - Transferencias del día: entradas (`tblTransferenciasEntradas`) y salidas propias
    (`tblTransferenciasSalidas` con `IdTienda` de la sesión), con tienda origen/destino.
  - Facturación del día (`tblFacturas`): total, IVA y detalle (globales vs cliente).
- **Artículos → Precios** (`/dashboard/articulos/precios`): versión web de la pantalla
  `frmCatArticulosServer.frm` de KYKServer2 (VB6). Búsqueda por descripción/código de barras,
  filtro por proveedor, "ver cambios a partir de" (FechaAct), grid paginado (50 por página) y
  detalle con pestañas **Venta** (precio, IVA, oferta interna, oferta pública vigente de
  `tblOfertasPublicas`, descuento mayoreo por escalas con redondeo hacia arriba a la décima) y
  **Compra** (proveedores del artículo vía `tblArticulosProveedor` — usando `CodigoInterno2` con
  respaldo a `CodigoInterno` —, costo caja/unitario, descuentos D0-D4 y costo real en cascada).
- **Artículos → Precios Básculas** (`/dashboard/articulos/precios-basculas`): versión web de
  frmRepBasculas / vlArticulosBasculas ("Códigos para Básculas"). Graneles activos con código
  numérico, códigos de báscula `00-` (menudeo), `10-`/`20-` (mayoreo con escala, precio con
  RedondearMas) y variante **rebanada** detectada por patrón `1 + código base` (01-XXX). El
  "Tipo de Granel" del VB6 (solo existe en el Access de oficina) se sustituye por el
  departamento de tienda. Precio actual con prioridad oferta pública > interna > precio.
  Export PDF/Excel. Nota de rendimiento: 3 consultas planas + cruce en JS (las subconsultas
  correlacionadas tardaban ~18 s en el MySQL de tienda).
- **Artículos → Ofertas** (`/dashboard/articulos/ofertas`): versión web de los reportes de ofertas
  del menú de frmCatArticulosServer. Tab **Internas** (`tblSesionesOfertas` +
  `tblDetalleSesionesOfertas` — en el MySQL de tienda `tblArticulos.PrecioOferta` está siempre en
  NULL, no se usa) y tab **Publicadas** (`tblOfertasPublicas`). Ambos con vigencia, filtro "solo
  vigentes" por default y estado Vigente/Por iniciar/Vencida según el reloj de la tienda. El % de
  descuento se calcula como `1 − (Oferta / Precio)`, igual que frmCatOfertasPublicas. Tope de
  1,000 filas con aviso.

Nota de esquema: `tblRecibo2` dejó de usarse en 2010; los recibos vigentes están en `tblReciboMovil`.

- **Operaciones → Cortes de Caja** (`/dashboard/operaciones/cortes`): adaptación del "Monitor
  de Operaciones" de kyk-dashboard a una sola tienda (MySQL local). Una fila por apertura de
  terminal con columnas Apertura (Z, hora, cajero) / Ventas por terminal / Cancelaciones /
  Cierre (hora, duración, supervisor; "Caja abierta" si no ha cerrado). KPIs del día, fecha con
  presets Hoy/Ayer/Antier, búsqueda por cajero o Z, y drill-down a tickets de venta y detalle
  de artículos cancelados por apertura. Tablas: `tblAperturasCierres`, `tblVentas`,
  `tblCancelaciones` + `tblDetalleCancelaciones`. Export PDF/Excel del día, y la tarjeta de
  Cierre abre el **ticket de corte** (`TicketCorte` del POS) con botón de impresión a PDF
  (fuente courier, tal cual el ticket).
- **Operaciones → Facturas** (`/dashboard/operaciones/facturas`): versión web de frmProcFacturas.
  Combina en un listado los documentos del rango: facturas de `tblFacturas` clasificadas como en
  el buffer del VB6 (IdApertura>0 → PÚBLICO GENERAL con su Z; Credito 0/1/2 → CONTADO / CRÉDITO /
  NOTA CRÉDITO), traslados de salida propios y entradas de transferencia — sin escribir el
  buffer `tblBufferDocumentos` (se combina en memoria). Badges de color por tipo y por método de
  pago (01 efectivo, 02 cheque, 03 transferencia, 04 tarjeta crédito, 28 débito), búsqueda con
  la semántica del VB6 (número → total o folio; texto → RFC/receptor/UUID/folio), filtro por
  tipo, resumen y export PDF/Excel. El modal de detalle sigue los formularios del VB6:
  factura (frmProcDetalleFacturas) → datos fiscales del cliente (`tblClientes` por RFC), uso
  CFDI/forma de pago y tabs **Conceptos** (artículos agrupados de `tblDetalleVentas` de las
  ventas amparadas) / **Tickets**; público general (frmProcCorteFacturaServer) → además apertura
  (cajero/supervisor) y **desglose de formas de pago** (tblVentasTarjeta/Cheques/Transferencias/
  Vales/Devoluciones; efectivo = suma tickets − demás formas); traslado
  (frmProcDetalleFacturasTraslados) → partidas con `Mov > 0` y usuario que realizó la salida.
- **Operaciones → Recibos** (`/dashboard/recibos/reporte`): versión web de frmProcRecibos.
  Recibos de mercancía (`tblReciboMovil` + proveedor) por rango de fechas (default hoy, presets
  7/30 días), búsqueda como el VB6 (número → IdReciboMovil/folio; texto → proveedor/RFC LIKE,
  UUID o folio exactos), tarjetas de resumen del rango y clic en el renglón abre el modal de
  partidas (`tblDetalleReciboMovil`, equivalente a frmProcDetalleReciboMovil; importe =
  Rec × Costo con descuentos en cascada, cuadra contra TotalRecibo). Export PDF/Excel.
  El modal tiene botón **Imprimir**: replica el formato del webservice Java (incluye el
  **código de barras Code 128 del folio**, dibujado sin librerías externas en
  [src/lib/barcode.ts](src/lib/barcode.ts))
  `ImprimirReciboMovil` (misma estructura y cálculos, presentación más limpia) — encabezado de
  empresa con logo (`tblTiendas` + `tblRazonesSociales`), condiciones de pago y orden de compra,
  partidas con descuentos 1-5 + mayoreo (V) e IEPS/IVA por partida, devoluciones a proveedor,
  cajas de totales (RECIBO / DEVOLUCIONES / TOTAL / CANASTILLAS / DIF. TOTALES vs pedido y
  factura), destares y temperaturas, y pedidos pendientes del proveedor. Datos de
  `/api/recibos/[id]/impresion` (**solo lectura** — sin los UPDATEs que ejecuta el Java);
  PDF en [src/lib/recibo-pdf.ts](src/lib/recibo-pdf.ts), abre en pestaña nueva.

- **Operaciones → Transferencias** (`/dashboard/transferencias/reporte`): reporte similar al de
  Recibos con tabs **Entradas** (`tblTransferenciasEntradas` + su salida ligada por FolioEntrada
  para origen/descripcion) y **Salidas** (propias, con destino y estado Recibida/En tránsito).
  El Total del encabezado casi siempre viene en 0, así que el monto se calcula del detalle
  (`SUM(Mov × Costo)` de `tblDetalleTransferenciasSalidas`, consultas planas + cruce en JS por
  falta de índices). Rango de fechas, búsqueda, resumen, modal de partidas y export PDF/Excel.
  El modal tiene botón **Imprimir** con el mismo formato de documento que el recibo
  ([src/lib/transferencia-pdf.ts](src/lib/transferencia-pdf.ts)): encabezado de empresa con
  logo, caja fecha/folio, origen→destino con estado, partidas y monto total.

- **Operaciones → Otros Movimientos** (`/dashboard/operaciones/movimientos`): movimientos de
  inventario (ajustes, mermas, consumos internos, cortesías de proveedor...) con la misma
  estructura que Transferencias. Tabs **Entradas/Salidas** (`tblMovimientos2.TipoMovimiento`
  0/1), concepto, usuario que lo realizó y proveedor opcional; monto calculado del detalle
  (`SUM(Mov × Costo)` de `tblDetalleMovimientos2`, el Total del encabezado viene en null).
  Rango de fechas, búsqueda, resumen, modal de partidas y export PDF/Excel.

- **Operaciones → Devoluciones de Venta** (`/dashboard/operaciones/devoluciones`): versión de
  consulta de frmProcDevolucionesVenta. `tblDevolucionesVenta` (clave, cliente, motivo, empleado,
  valor, estado de canje — `IdComputadoraCanje > 0` = vale canjeado en caja, con fecha; badge NC
  si se timbró nota de crédito) + modal de partidas de `tblDetalleDevolucionesVenta`
  (`CantidadAnterior` = cantidad del ticket, `Cantidad` = devuelta; las filas con 0 se atenúan;
  importe = Cantidad × PrecioVenta, cuadra con Valor). Rango de fechas, búsqueda, resumen
  (canjeadas/pendientes) y export PDF/Excel.

- **Operaciones → Devoluciones de Compra** (`/dashboard/operaciones/devoluciones-compra`):
  versión de consulta de frmProcDevolucionesCompra. No hay tabla de encabezado: tab
  **Pendientes** = `tblDetalleDevolucionesCompra` (mercancía apartada por devolver al proveedor,
  se vacía al procesarse) y tab **Historial** = `tblDetalleDevolucionesCompraHistorial` con
  rango de fechas. Importe estimado con `tblArticulosProveedor.Costo` (respaldo `UltimoCosto`).
  Búsqueda, resumen (partidas/proveedores/monto) y export PDF/Excel.

- **Comunicación → Comunicados** (`/dashboard/comunicados`): fase 1 del portal de comunicación.
  Base central propia **BDKYKPortal** (mismo servidor MySQL central; las tablas se crean solas —
  `comunicados`, `comunicados_tiendas`, `comunicados_acuses`, `portal_usuarios`). Oficina publica
  (título, cuerpo, urgente, vigencia, todas las tiendas o específicas) y las tiendas **confirman
  de enterado**; oficina ve el tablero de acuses por tienda (quién confirmó y quién falta).
  **Campana en el header** con badge de no confirmados (rojo si hay urgentes, se actualiza cada
  minuto) y **banner rojo en Principal** cuando hay urgentes pendientes. Los comunicados aceptan
  **archivos adjuntos** (arrastrar y soltar, máx. 10 × 25 MB, `comunicados_adjuntos` +
  `uploads/comunicados/`) con chips de descarga validados por tienda. Rol oficina: env
  `PORTAL_OFICINA` (códigos de barras separados por coma) o fila en `portal_usuarios` con
  Rol='oficina'.

- **Comunicación → Documentos** (`/dashboard/documentos`): fase 2 del portal. Repositorio de
  archivos con **carpetas** (chips), targeting por tienda (todas o específicas), subida por
  oficina (máx. 25 MB; archivos en `uploads/documentos/` del servidor — configurable con
  `PORTAL_UPLOADS` — y metadatos en BDKYKPortal), descarga con **auditoría** (quién bajó qué
  y cuándo; oficina ve el conteo y el detalle por documento) y retiro suave. Búsqueda por
  nombre/archivo/carpeta. Subida con **arrastrar y soltar** (varios archivos a la vez — cada uno
  queda como documento propio — e incluso soltándolos sobre la página, que abre el modal
  precargado).

- **Comunicación → Chat** (`/dashboard/chat`): fase 3 del portal. Canales lógicos sin tabla de
  canales: **General** (todas las tiendas) y **tienda↔oficina** por tienda (oficina ve todos).
  Mensajes en `chat_mensajes` con **fotos adjuntas** (máx. 10 MB, en `uploads/chat/`, servidas
  con validación de acceso al canal) y lecturas en `chat_lecturas` (badges de no leídos por
  canal). Tiempo real por **polling**: mensajes del canal abierto cada 5 s (incremental por
  IdMensaje) y badges cada 15 s — robusto ante los cortes de VPN nocturnos; SSE queda como
  mejora futura. Burbujas con nombre y tienda del emisor, Enter envía, Shift+Enter salto.

- **Kesito** (burbuja flotante en todo el dashboard): fase 4 del portal — agente inteligente de
  la tienda. Widget de chat ([src/components/dashboard/KesitoChat.tsx](src/components/dashboard/KesitoChat.tsx))
  contra `/api/chat/kesito`, que corre un loop agéntico con **Claude Sonnet** (`@anthropic-ai/sdk`,
  requiere `ANTHROPIC_API_KEY` en `.env`; sin ella responde 503). Las herramientas del agente son
  las **propias APIs del portal** invocadas con la cookie de la sesión, así que solo ve datos de
  la tienda conectada: resumen del día, precios y detalle de artículos, ofertas, precios de
  báscula, cortes de caja, recibos, transferencias, facturas y devoluciones (venta y compra).
  El system prompt lo acota estrictamente a ese alcance (nada de SQL libre ni temas generales).
  Resultados compactados (listas recortadas + tope de 12 KB) para controlar tokens; máx. 6
  iteraciones de herramientas y últimos 12 mensajes de historial. La conversación persiste en
  `sessionStorage`; sugerencias de arranque, Enter envía, Esc cierra.

### Exportación (Precios y Ofertas)

Botones **PDF** (jsPDF + autotable) y **Excel** (xlsx-js-style) en ambas pantallas — misma
tecnología que kyk-dashboard, en reemplazo de los reportes Crystal del VB6. Exportan el
resultado **completo** del filtro activo (en Precios se re-consulta con `pageSize=20000`, no
solo la página visible), con título de reporte, tienda, fecha, filtro aplicado y folios de
página. Helper compartido en [src/lib/export.ts](src/lib/export.ts).

## Estructura

- `src/lib/db.ts` — SQL Server (BDKYK), validación de usuarios.
- `src/lib/mysql.ts` — MySQL central (BDKYKRemoto), catálogo de tiendas.
- `src/lib/tiendas.ts` — consulta y cache del catálogo de tiendas con reportes.
- `src/lib/tienda-db.ts` — pools MySQL por tienda para los reportes.
- `src/lib/session.ts` — sesión JWT (cookie `session`, 24 h).
- `src/app/login` — página de login (diseño oscuro esmeralda/cian, diferenciado de kyk-dashboard).
- `src/app/dashboard` — placeholder de bienvenida (aquí irán los nuevos reportes).

## Desarrollo

```bash
npm install
npm run dev    # puerto 3005
npm run build
npm start      # puerto 3006
```

Variables de entorno en `.env` (SQL Server, MySQL central y `JWT_SECRET`).
