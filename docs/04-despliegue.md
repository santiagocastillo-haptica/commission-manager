# Despliegue en Firebase (App Hosting + Firestore)

La aplicación corre en **Firebase App Hosting** (Next.js sobre Cloud Run) y guarda sus datos en **Cloud Firestore**. El código vive en un repositorio **privado** de GitHub; cada `git push` a `main` despliega automáticamente.

> GitHub Pages no sirve para esta aplicación (solo publica sitios estáticos). GitHub guarda el código; Firebase la ejecuta.

| Pieza | Servicio | Detalle |
|---|---|---|
| Aplicación | Firebase App Hosting | Proyecto `haptica-commission-manager`, región **us-east4** (São Paulo no está disponible; es la más cercana a Colombia), configurada en `apphosting.yaml` |
| Datos | Cloud Firestore | Base `(default)`, edición Standard, **us-east4** (la ubicación es permanente), recuperación a un punto en el tiempo (7 días) y protección contra eliminación activas |
| Secretos | Secret Manager | `session-secret` (el secreto `setup-token` ya no se usa y puede eliminarse) |
| Reglas | `firestore.rules` | Niegan todo acceso de clientes; solo el servidor (SDK Admin) lee y escribe. Ya desplegadas |

## Estado actual

| Paso | Quién | Estado |
|---|---|---|
| Firestore creado, reglas y protecciones | Hecho | ✅ |
| Secreto `session-secret` | Hecho | ✅ |
| `apphosting.yaml`, ingreso con Google, CI | Hecho | ✅ |
| Plan **Blaze** y alerta de presupuesto | Tú | ✅ / revisar alerta |
| Código en GitHub (repositorio privado) y backend `commission-manager` de App Hosting | Hecho | ✅ |
| Permisos del backend sobre secretos y Firestore | Hecho | ✅ |
| Ingreso con Google: activar el proveedor y autorizar el dominio en Firebase Authentication | Tú | ⬜ |
| Primer ingreso con `BOOTSTRAP_ADMIN_EMAIL` y verificación en producción | Tú | ⬜ |

## Paso a paso

### 1. Plan Blaze y presupuesto
En la consola de Firebase: *Configuración → Uso y facturación → Modificar plan → Blaze*. Luego en Google Cloud *Facturación → Presupuestos y alertas*: crea un presupuesto pequeño (p. ej. USD 10/mes) con alertas al 50 %, 90 % y 100 %. Con este volumen el costo debería ser mínimo (App Hosting escala a cero con `minInstances: 0`).

### 2. Subir el código a GitHub
Crea el repositorio **privado** `haptica-commission-manager` (sin README inicial) y, desde la carpeta del proyecto:

```bash
git add -A
git commit -m "Háptica Commission Manager"
git branch -M main
git remote add origin https://github.com/<tu-organización>/haptica-commission-manager.git
git push -u origin main
```
`.env`, `.env.local` y los datos del emulador están en `.gitignore`: no se suben. La CI (`.github/workflows/ci.yml`) correrá lint, tipos, las 170+ pruebas contra el emulador y el build.

### 3. Crear el backend de App Hosting
```bash
firebase apphosting:backends:create --project haptica-commission-manager
```
Responde: región **us-east4**, ID de backend `haptica-commission-manager`, conecta tu cuenta de GitHub (autoriza la app *Firebase App Hosting* sobre ese repositorio), rama activa **main**, directorio raíz `/`, y activa el despliegue automático. (Alternativa: *Firebase Console → App Hosting → Comenzar*.)

### 4. Permisos del backend
El backend usa la cuenta de servicio `firebase-app-hosting-compute@haptica-commission-manager.iam.gserviceaccount.com` (se crea con el backend).

```bash
# Que pueda leer los secretos
firebase apphosting:secrets:grantaccess session-secret --backend commission-manager --project haptica-commission-manager
```
Y para Firestore, en *Google Cloud Console → IAM → Conceder acceso*: principal = esa cuenta de servicio, rol **Cloud Datastore User** (`roles/datastore.user`). Es el rol mínimo para leer y escribir documentos.

### 5. Ingreso con Google (Firebase Authentication)
La aplicación entra con **Google**; la contraseña queda solo como respaldo para usuarios que la tengan.

1. Consola de Firebase → *Compilación → Authentication → Comenzar → Método de acceso → Google → Habilitar*. Elige el correo de asistencia del proyecto y guarda.
2. *Authentication → Configuración → Dominios autorizados → Agregar dominio*: `commission-manager--haptica-commission-manager.us-east4.hosted.app` (y tu dominio propio cuando lo tengas). `localhost` ya viene autorizado.
3. Abre la aplicación y haz clic en **Ingresar con Google**. La cuenta indicada en `BOOTSTRAP_ADMIN_EMAIL` (`apphosting.yaml`) se crea como **administrador** en su primer ingreso, con las políticas y la meta inicial. Cualquier otra cuenta debe estar registrada como usuario en la aplicación; si no, se le niega el acceso.

Las claves `NEXT_PUBLIC_FIREBASE_*` son **públicas** por diseño (identifican la app web, no dan acceso a datos); la seguridad está en que el servidor verifica el token de Google y que las reglas de Firestore niegan todo acceso de clientes.

### 6. Verificación en producción
1. Ingresa con el administrador y confirma que Dashboard, Configuración y Liquidaciones cargan.
2. Descarga un reporte (PDF y Excel) de una liquidación de prueba **solo si ya hay datos**; en un entorno vacío no hay liquidaciones.
3. `npm run verify:integrity` contra Firestore real necesita credenciales de Google (`GOOGLE_APPLICATION_CREDENTIALS` con una cuenta de servicio con rol *Cloud Datastore Viewer*). Sin FIRESTORE_EMULATOR_HOST define el destino real.

## Operación

- **Actualizaciones:** `git push` a `main` → App Hosting compila y despliega. No hay migraciones de esquema: Firestore no las tiene; si un cambio altera la forma de los documentos, debe ser compatible con los datos existentes o incluir un script de migración.
- **Secretos:** rotar `SESSION_SECRET` cierra todas las sesiones: `firebase apphosting:secrets:set session-secret` y un nuevo despliegue.
- **Copias de seguridad:** recuperación a un punto en el tiempo (7 días) ya activa. Antes de aprobar cada liquidación conviene ejecutar `npm run verify:integrity`. Para copias de largo plazo se pueden programar exportaciones de Firestore a Cloud Storage.
- **Cierre por lotes interrumpido:** si una liquidación queda en estado *CLOSING*, se reanuda con la acción `resumeClosingAction` (sin duplicar nada); mientras tanto el resto de las escrituras de negocio se rechazan.
- **Seguridad:** HTTPS lo da Google; la aplicación envía HSTS y cabeceras de seguridad, la cookie de sesión es `httpOnly` y `secure`, y el ingreso tiene límite de intentos guardado en Firestore.
- **Dominio propio:** *App Hosting → Dominios* en la consola de Firebase.
- **Costos:** Firestore y App Hosting cobran por uso (lecturas/escrituras, CPU y memoria de las instancias); la aplicación lee colecciones completas y agrega en memoria, adecuado para cientos de proyectos. Revisa los precios vigentes y el presupuesto configurado.

## Qué NO hacer

- **No definas `FIRESTORE_EMULATOR_HOST` en producción** (haría que la aplicación busque un emulador inexistente).
- **No ejecutes `npm run seed` contra producción:** se niega a correr sin el emulador, pero no lo intentes con variables de entorno de otro entorno.
- No subas `.env*` a Git.
