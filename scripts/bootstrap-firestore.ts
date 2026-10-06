/**
 * Datos iniciales mínimos en Firestore (administrador, políticas, meta). Idempotente: no borra nada.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/bootstrap-firestore.ts
 *
 * Contra Firestore real se necesitan credenciales de Google (GOOGLE_APPLICATION_CREDENTIALS). Para producción
 * se prefiere la página de configuración inicial protegida con un token (ver docs/05-migracion-firestore.md).
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { bootstrapBase, resetPassword } from "../src/store/bootstrap";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Define ADMIN_EMAIL y ADMIN_PASSWORD.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");

  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulador (${process.env.FIRESTORE_EMULATOR_HOST})` : "Firestore REAL";
  console.log(`Destino: ${target}`);

  const passwordHash = await bcrypt.hash(password, 12);
  if (process.env.RESET_ADMIN_PASSWORD === "1") {
    console.log((await resetPassword(email, passwordHash)) ? `Contraseña restablecida para ${email}` : `No existe el usuario ${email}`);
    return;
  }
  const r = await bootstrapBase({ email, name: process.env.ADMIN_NAME ?? "Administrador", passwordHash });
  console.log(r.adminCreated ? `Administrador creado: ${email}` : `El administrador ${email} ya existe (sin cambios).`);
  if (r.policiesCreated.length) console.log(`Políticas creadas: ${r.policiesCreated.join(", ")}`);
  if (r.goalCreated) console.log("Meta mensual inicial creada: $390.000.000.");
  console.log("Bootstrap completado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
