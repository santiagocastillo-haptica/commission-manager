# Háptica Commission Manager

Aplicación web interna para **administrar, calcular, liquidar y auditar las comisiones comerciales** de Háptica (Colombia, Chile, México, Guatemala, Estados Unidos, Ecuador y Perú). Reemplaza el proceso manual: el administrador actualiza los recaudos, selecciona el período, revisa los resultados y genera todas las liquidaciones sin hacer cálculos a mano.

| Documento | Contenido |
|---|---|
| [docs/01-diseno-tecnico.md](docs/01-diseno-tecnico.md) | Arquitectura, modelo de datos y decisiones de negocio confirmadas |
| [docs/02-motor-de-comisiones.md](docs/02-motor-de-comisiones.md) | Reglas exactas del motor de cálculo y limitaciones conocidas |
| [docs/03-guia-de-uso.md](docs/03-guia-de-uso.md) | Guía paso a paso para quien administra las comisiones |
| [docs/04-despliegue.md](docs/04-despliegue.md) | Cómo publicar la aplicación (GitHub + hosting + base de datos) |

## Qué incluye

| Módulo | Estado |
|---|---|
| Autenticación: ingreso con Google (correos registrados) y contraseña de respaldo | Listo |
| Dashboard: ventas, meta, facturación, recaudo y comisiones (potencial / generada / pendiente / liquidada) | Listo |
| Proyectos: alta, edición, anulación, asignación de % con historial, elegibilidad con motivo | Listo |
| Facturas y recaudos: parciales, multimoneda con TRM, anulación, ajustes | Listo |
| Colaboradores: ficha, política de comisiones, historial | Listo |
| Configuración: meta, validación mensual de ventas, tasas de cambio, políticas, auditoría | Listo |
| Motor de comisiones (política general, gamificación de Nicholle, multimoneda, ajustes) | Listo — probado |
| Liquidaciones: asistente de 6 pasos, cierre transaccional e inmutable, pagos | Listo |
| Reportes: PDF individual por colaborador, ZIP, reporte administrativo PDF y Excel | Listo |

## Requisitos

- Node.js 20 o superior (probado con 24) y npm.
- **Java 21+** para el emulador de Firestore (desarrollo y pruebas). En Windows sin permisos de administrador se usa un JDK portátil en `~/tools/jdk21` (o define `HAPTICA_JAVA_HOME`); `scripts/firebase-env.mjs` lo encuentra solo.
- Datos en **Cloud Firestore** (Firebase). En desarrollo se usa el **emulador**, sin tocar datos reales.

## Primer arranque (desarrollo, con datos de demostración)

```bash
npm install
cp .env.example .env        # y completa los valores (ver tabla)
npm run emulator            # emulador de Firestore en 127.0.0.1:8085 (déjalo corriendo; guarda sus datos en .firebase-data/)
npm run seed                # en otra terminal: datos de demostración (ficticios) + usuario administrador
npm run dev                 # http://localhost:3000
```

Con los datos de demostración la liquidación de abril 2026 ya está aprobada (con pagos) y la de octubre 2026 queda abierta para recorrer el asistente.

Para **producción** no uses el seed (solo funciona contra el emulador): el administrador se crea al ingresar por primera vez con Google la cuenta de `BOOTSTRAP_ADMIN_EMAIL`. Ver [docs/05-migracion-firestore.md](docs/05-migracion-firestore.md) y [docs/04-despliegue.md](docs/04-despliegue.md).

### Variables de entorno (`.env`)

| Variable | Uso |
|---|---|
| `SESSION_SECRET` | Cadena aleatoria de 32+ caracteres para firmar la sesión |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Administrador que crean `seed` y `bootstrap` (contraseña de 12+ caracteres) |
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8085` en desarrollo. **No se define en producción** (se usa Firestore real con la cuenta de servicio del entorno) |
| `GCLOUD_PROJECT` | `haptica-commission-manager` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID` | Opcionales en desarrollo: activan el botón «Ingresar con Google» (valores públicos de la app web de Firebase) |
| `BOOTSTRAP_ADMIN_EMAIL` | Cuenta de Google que se crea como administrador en su primer ingreso |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilar y servir en producción |
| `npm test` | Pruebas de dominio y reportes (las de Firestore se omiten sin emulador) |
| `npm run test:store` | **Todas** las pruebas, incluidas las de integración contra el emulador de Firestore (lo levanta y apaga solo) |
| `npm run lint` / `npm run typecheck` | Calidad de código y tipos |
| `npm run emulator` | Emulador de Firestore con datos persistentes (`.firebase-data/`) |
| `npm run seed` | **Borra** y recarga los datos de demostración (solo contra el emulador) |
| `npm run bootstrap` | Crea el administrador y la configuración inicial, sin borrar nada |
| `npm run verify:integrity` | Revisión de solo lectura: totales, compromisos, recaudos liquidados no alterados, pagos (emulador o Firestore real) |

## Estructura

```
src/store/       capa de acceso a Firestore: transacciones, unicidad, auditoría, bloqueo de cierre, compromisos anti pago doble
src/domain/      reglas de negocio puras (sin Next, React ni Firestore): dinero, fechas, períodos, políticas, motor
src/server/      acciones (mutaciones), servicios (meses, liquidaciones, pagos), consultas, autenticación, integridad
src/reports/     PDF individual, PDF y Excel administrativos
src/app/         páginas por módulo y rutas de descarga (/api/liquidaciones/...)
src/components/  interfaz reutilizable
scripts/         seed, bootstrap, verificación de integridad y ayudante del emulador
tests/           dominio, reportes, capa de datos y flujos completos contra el emulador
docs/            documentación
```

## Garantías de integridad

Firestore no tiene triggers ni restricciones `CHECK`: las garantías se imponen en una **única capa de acceso** (`src/store` + `src/server`) y se comprueban con `npm run verify:integrity`. Detalle y límites en [docs/05-migracion-firestore.md](docs/05-migracion-firestore.md#3-garantías-cómo-se-conservan).

- No se eliminan proyectos, facturas, recaudos, ajustes, pagos ni colaboradores: se **anulan con motivo**. La bitácora de auditoría es de solo inserción.
- Una liquidación aprobada es **inmutable**; también lo son los recaudos, facturas y asignaciones liquidados y los ajustes aplicados (cada acción lo verifica contra los `commitments`).
- Un documento `commitments/{recaudo}__{asignación}` creado con `create()` impide liquidar dos veces el mismo recaudo para la misma asignación.
- El cierre normal es **una sola transacción**; si fuera enorme, se usa un protocolo por lotes reanudable.
- Los pagos se hacen en transacción: dos pagos simultáneos no pueden exceder el neto.
- Reglas de seguridad de Firestore: **niegan todo acceso de clientes**; solo el servidor lee y escribe.

## Limitaciones conocidas (V1)

- No hay un movimiento de «reversión» de un recaudo ya liquidado (las notas crédito y descuentos sí se manejan).
- La escala de gamificación se edita desde Configuración → Políticas (nueva escala con fecha de inicio, editar o eliminar), con la restricción de no tocar escalas ya usadas para validar un mes.
- Un solo usuario administrador; la sesión no se puede revocar antes de vencer (8 h).
- El logotipo en los PDF es un texto provisional («HÁPTICA») hasta contar con el archivo oficial; la tipografía es Montserrat/Helvetica en lugar de Gotham.
- Las tasas de cambio se ingresan manualmente (sin integración con servicios externos).
- La firma electrónica no está incluida: los PDF se descargan para firmarse en el sistema de Háptica.

Más detalle en [docs/02-motor-de-comisiones.md](docs/02-motor-de-comisiones.md#6-limitaciones-conocidas-v1).

## Notas de desarrollo

- El emulador necesita Java; `scripts/firebase-env.mjs` fija un directorio temporal propio porque en Windows la ruta por defecto (nombres cortos 8.3) hace fallar el emulador.
- Tras recargar los datos con `seed`, la sesión abierta en el navegador deja de ser válida si el usuario ya no existe: hay que volver a ingresar.
- Evita en las consultas varios filtros a la vez: en Firestore real exigen índices compuestos. La aplicación filtra en memoria el resto.
