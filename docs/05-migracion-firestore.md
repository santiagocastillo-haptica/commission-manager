# Migración a Firestore + Firebase App Hosting — diseño

Estado: **diseño aprobado el 2026-10-06. Fase A completada** (capa de datos, reglas, emulador, bootstrap). Fases B–F pendientes.
Proyecto Firebase: `haptica-commission-manager` (n.º 186702496639).

## 1. Qué cambia y qué no

| Se conserva | Se reescribe | Desaparece |
|---|---|---|
| Todo `src/domain` (motor, políticas, períodos, dinero con `decimal.js`) | La capa de datos: `src/server/queries`, `services`, `actions`, `auth`, `audit`, `report-http` | Prisma, migraciones SQL, triggers y `CHECK` de PostgreSQL |
| Interfaz (páginas, componentes, formularios, gráficos) | `seed`, `bootstrap` y las pruebas de integración | PostgreSQL embebido, `db:start`, `db:migrate` |
| Reportes PDF y Excel (leen las fotos de la liquidación) | Configuración de despliegue (`apphosting.yaml`) | `vercel.json`, Neon |
| Reglas de negocio y pruebas del dominio (≈70 pruebas) | | |

## 2. Modelo de datos

Reglas generales: dinero y tasas como **texto decimal** (se calculan con `decimal.js`); fechas de negocio como `"YYYY-MM-DD"`; instantes como `Timestamp`; todo acceso desde el servidor con el **SDK Admin** (las reglas de seguridad niegan todo acceso de clientes).

| Colección | ID del documento | Contenido |
|---|---|---|
| `users` | id aleatorio | correo, nombre, hash de la contraseña |
| `policies` | `GENERAL`, `GAMIFICATION` | tipo y tramos (embebidos) |
| `goals` | fecha de vigencia | meta mensual |
| `exchangeRates` | `USD_2026-10-05` | TRM manual |
| `collaborators` | id aleatorio | datos, política, estado |
| `uniques` | `email:…`, `invoice:{proyecto}:{número}` | índices de unicidad creados dentro de la transacción |
| `monthlySales` | `2026-01` | estado, ajuste manual, foto de validación |
| `projects` | **código del proyecto** (único por construcción) | datos, base neta, **asignaciones embebidas** (con versiones de porcentaje y retiro) |
| `invoices` | id aleatorio | factura + **recaudos embebidos** (pocas decenas por factura) |
| `adjustments` | id aleatorio | notas crédito, descuentos, costos |
| `settlements` | **código** (`LIQ-2026-10`) | estado, totales, alertas reconocidas, foto administrativa |
| `settlements/{código}/lines` | `{recaudo}__{asignación}` | líneas con su foto |
| `settlements/{código}/people` | id del colaborador | liquidación individual, foto, pagos embebidos |
| `commitments` | `{recaudo}__{asignación}` | **clave anti pago doble** (ver 3.1) |
| `generatedReports`, `auditLog`, `loginThrottle` | id aleatorio / clave | trazabilidad y límite de intentos |

Ubicación de Firestore: **`us-east4`** (misma región que App Hosting, la más cercana a Colombia disponible). **Es permanente.** Edición Standard, modo producción.

## 3. Garantías: cómo se conservan

### 3.1 Un recaudo no se paga dos veces
Al cerrar una liquidación se crea un documento `commitments/{recaudo}__{asignación}` con `create()`, que **falla si ya existe**. Es la misma garantía que hoy da el índice único, sin carreras: se escribe dentro de la transacción de cierre.

### 3.2 Cierre atómico
Verificado en la documentación vigente de cuotas de Firestore (octubre de 2026): **ya no existe el tope de 500 escrituras por transacción**; los límites son una solicitud de **10 MiB** y **270 s** por transacción (60 s sin actividad). Por eso:
- **Cierre normal** (siempre que el cierre estime menos de 8 MiB, miles de líneas): **una sola transacción** que verifica totales revisados y alertas, escribe líneas + `commitments` + liquidaciones individuales, marca ajustes aplicados y cambia el estado a APROBADA. Todo o nada.
- **Respaldo para cierres enormes** (más de ≈8 MiB): protocolo por lotes e idempotente. (1) transacción que marca la liquidación `CLOSING` y bloquea el resto de las escrituras de negocio (`system/state`); (2) lotes de ≤400 documentos con IDs deterministas; (3) transacción final que la pasa a APROBADA. Si se interrumpe, queda `CLOSING` y se **reanuda** sin duplicar. `fitsInOneTx()` decide.

### 3.3 Inmutabilidad (la garantía más débil frente a PostgreSQL)
PostgreSQL la imponía con triggers; Firestore no los tiene. Se reemplaza por:
1. **Una única capa de acceso** (`store/`): ninguna página ni acción escribe directamente. Cada escritura sobre recaudos, facturas, asignaciones, ajustes o liquidaciones verifica `commitments`/estado y se rechaza si ya fueron liquidados.
2. Reglas de seguridad que **niegan todo acceso de clientes**; solo el servidor escribe.
3. **Script de verificación de integridad** (`npm run verify:integrity`): recalcula totales desde las líneas, comprueba que cada línea tenga su `commitment`, que no existan recaudos liquidados modificados (huella guardada en la foto) y que los pagos no superen el neto. Se ejecuta en CI y antes de cada cierre.
4. Copias de seguridad programadas y **recuperación a un punto en el tiempo** activadas en Firestore.

Es una protección de **proceso**, no de motor de base de datos: un error nuestro en la capa de acceso podría saltársela, algo que los triggers no permitían.

### 3.4 Unicidad y cantidades
Código de proyecto = ID del documento; correo y número de factura por proyecto, con documentos en `uniques` creados en la misma transacción. Los CHECK (base ≥ 0, ≤ 1 %, montos > 0) pasan a validación Zod en la capa de acceso.

### 3.5 Consultas
Firestore no hace JOIN ni sumas complejas; el volumen es pequeño (cientos de proyectos), así que se cargan los datos necesarios y se agregan en memoria con el dominio existente, igual que hoy.

## 4. Autenticación
Se mantiene la sesión propia (JWT en cookie `httpOnly`) con el usuario guardado en Firestore y el límite de intentos en `loginThrottle`. Firebase Authentication (con Google) es una mejora posible más adelante.

## 5. Despliegue
- **Firebase App Hosting** (Next.js sobre Cloud Run) desde el repositorio de GitHub, región `us-east4`, configurado con `apphosting.yaml`.
- Secretos (`SESSION_SECRET`, etc.) en Secret Manager (`firebase apphosting:secrets:set`).
- La cuenta de servicio de App Hosting recibe el rol `roles/datastore.user` para leer y escribir en Firestore.
- Plan **Blaze** (pago por uso) con presupuesto y alertas.
- Sin base de datos con mensualidad fija: el costo con este volumen debería ser mínimo (revisa los precios vigentes de Firestore).

## 6. Pruebas
- Comando: `npm run test:store` (levanta el emulador con Java portátil, corre las pruebas y lo apaga).
- Dominio (≈70 pruebas): no cambian.
- Integración: se reescriben contra el **emulador de Firestore**, que necesita **Java 21+** (hoy no está instalado en este equipo). Las ≈45 pruebas de integración (cierre, anti pago doble, inmutabilidad, pagos simultáneos, límite de intentos, reglas de acciones) se portan una a una.
- Reportes: no cambian.

## 7. Plan por fases
| Fase | Entrega | Verificación |
|---|---|---|
| A ✅ | Capa `src/store/` (Admin SDK, transacciones, unicidad, auditoría, bloqueo de cierre, compromisos anti pago doble), reglas de seguridad, emulador, `bootstrap` | 23 pruebas en el emulador |
| B ✅ | Configuración, colaboradores, proyectos (consultas + acciones) | Pantallas + pruebas |
| C ✅ | Facturas, recaudos, ajustes | Pantallas + pruebas |
| D ✅ | Validación de meses, liquidaciones (cálculo, cierre, pagos), reportes | Las pruebas de cierre y anti pago doble portadas |
| E ✅ | `seed`, script de integridad, CI con emulador | 100 % de las pruebas |
| F (parte mía ✅) | App Hosting: backend, secretos, permisos, primer despliegue y revisión | Prueba en producción con datos de demostración |

## 8. Riesgos y decisiones abiertas
1. **Inmutabilidad por proceso** en lugar de por motor (sección 3.3).
2. **Firestore es permanente en su ubicación**: confirmar `us-east4`.
3. **Java** para el emulador: instalar JDK 21 (por ejemplo Temurin) en el equipo de desarrollo.
4. **Reversión de recaudos** y **edición de la escala de gamificación** siguen fuera de la V1.
5. Si más adelante necesitan reportes SQL ad hoc, habrá que exportar a BigQuery.
