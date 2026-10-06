/**
 * Verificación de integridad de los datos (solo lectura): `npm run verify:integrity`.
 * Contra el emulador (FIRESTORE_EMULATOR_HOST) o contra Firestore real (credenciales de Google). Sale con código 1 si hay problemas.
 */
import "dotenv/config";
import { verifyIntegrity } from "../src/server/integrity";

async function main() {
  console.log(`Destino: ${process.env.FIRESTORE_EMULATOR_HOST ? `emulador (${process.env.FIRESTORE_EMULATOR_HOST})` : "Firestore REAL"}`);
  const r = await verifyIntegrity();
  const c = r.checked;
  console.log(`Revisado: ${c.projects} proyectos, ${c.invoices} facturas, ${c.settlements} liquidaciones, ${c.lines} líneas, ${c.commitments} compromisos.`);
  if (r.ok) {
    console.log("✔ Integridad verificada: sin problemas.");
    return;
  }
  console.error(`✖ ${r.problems.length} problema(s):`);
  for (const p of r.problems) console.error(` - [${p.scope}] ${p.message}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
