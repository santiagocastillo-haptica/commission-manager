# Despliegue en Firebase (App Hosting + Firestore)

La aplicación corre en **Firebase App Hosting** (Next.js sobre Cloud Run) y guarda sus datos en **Cloud Firestore**. El código vive en un repositorio **privado** de GitHub; cada `git push` a `main` despliega automáticamente.

> GitHub Pages no sirve para esta aplicación (solo publica sitios estáticos). GitHub guarda el código; Firebase la ejecuta.

| Pieza | Servicio | Detalle |
|---|---|---|
| Aplicación | Firebase App Hosting | Proyecto `haptica-commission-manager`, región **us-east4** (São Paulo no está disponible; es la más cercana a Colombia), configurada en `apphosting.yaml` |
| Datos | Cloud Firestore | Base `(default)`, edición Standard, **us-east4** (la ubicación es permanente), recuperación a un punto en el tiempo (7 días) y protección contra eliminación activas |
| Secretos | Secret Manager | `session-secret` y `setup-token` (ya creados) |
| Reglas | `firestore.rules` | Niegan todo acceso de clientes; solo el servidor (SDK Admin) lee y escribe. Ya desplegadas |

## Estado actual

| Paso | Quién | Estado |
|---|---|---|
| Firestore creado, reglas y protecciones | Hecho | ✅ |
| Secretos `session-secret` y `setup-token` | Hecho | ✅ |
| `apphosting.yaml`, página `/setup`, CI | Hecho | ✅ |
| Plan **Blaze** y alerta de presupuesto | Tú | ⬜ |
| Subir el código al repositorio privado de GitHub | Tú | ⬜ |
| Crear el backend de App Hosting (conectar GitHub) | Tú, con ayuda | ⬜ |
| Permitir que el backend acceda a los secretos y a Firestore | Tú / comandos de abajo | ⬜ |
| Crear el administrador en `/setup` y probar | Tú | ⬜ |

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
firebase apphosting:secrets:grantaccess session-secret --backend haptica-commission-manager --project haptica-commission-manager
firebase apphosting:secrets:grantaccess setup-token    --backend haptica-commission-manager --project haptica-commission-manager
```
Y para Firestore, en *Google Cloud Console → IAM → Conceder acceso*: principal = esa cuenta de servicio, rol **Cloud Datastore User** (`roles/datastore.user`). Es el rol mínimo para leer y escribir documentos.

### 5. Primer despliegue y administrador
Tras el primer despliegue abre `https://<tu-backend>.<…>.hosted.app/setup`. Pide el token de configuración (se lee con `firebase apphosting:secrets:access setup-token`), el nombre, el correo y una contraseña de **12+ caracteres**. **Solo funciona una vez:** en cuanto existe cualquier usuario la página responde 404, aunque el token se filtre después. Además limita a 5 intentos fallidos por IP.

Después de crear el administrador puedes **retirar** `SETUP_TOKEN` de `apphosting.yaml` (la página queda cerrada igualmente).

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
- No subas `.env*` a Git ni compartas el `SETUP_TOKEN`.
