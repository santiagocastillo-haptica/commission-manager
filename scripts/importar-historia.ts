/**
 * Importa la plantilla de historia contra el EMULADOR de Firestore (prueba local, nunca producción) y compara con los pagos.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx scripts/importar-historia.ts <plantilla.xlsx> [--crear-colaboradores]
 * Para producción se usa la pantalla Configuración → Importar historia.
 */
import ExcelJS from "exceljs";
import { parseHistoryWorkbook, sortIssues } from "../src/server/import/history";
import { collaboratorsByEmail, comparePayments, importProject, validateClosedMonths } from "../src/server/import/history-load";
import { C, newId, now, ref, col } from "../src/store";
import { bootstrapBase } from "../src/store/bootstrap";

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Este script solo corre contra el emulador (FIRESTORE_EMULATOR_HOST).");
  const file = process.argv[2];
  if (!file) throw new Error("Uso: tsx scripts/importar-historia.ts <plantilla.xlsx> [--crear-colaboradores]");
  const projectId = process.env.GCLOUD_PROJECT ?? "haptica-commission-manager";
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await bootstrapBase({ email: "dev@haptica.local", name: "Dev", passwordHash: "x" });
  const adminId = (await col(C.users).where("email", "==", "dev@haptica.local").limit(1).get()).docs[0].id;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const { plan, issues } = parseHistoryWorkbook(wb);
  const sorted = sortIssues(issues);
  console.log(`Plan: ${plan.projects.length} proyectos, ${plan.emails.length} correos, ${plan.payments.length} pagos. Hallazgos: ${sorted.length} (bloqueantes ${sorted.filter((i) => i.severity === "Bloqueante").length})`);
  for (const i of sorted.filter((x) => x.severity === "Bloqueante")) console.log(" ✖", i.type, i.sheet, i.row, i.code, i.detail);

  if (process.argv.includes("--crear-colaboradores")) {
    // Solo para la prueba local: Nicholle con gamificación, el resto con política general.
    for (const email of plan.emails) {
      const id = newId();
      const t = now();
      await ref(C.collaborators, id).set({ id, fullName: email.split("@")[0], email, position: "Prueba", status: "ACTIVE", policyId: email.startsWith("nicholle") ? "GAMIFICATION" : "GENERAL", joinDate: null, notes: null, createdAt: t, updatedAt: t, createdById: adminId, updatedById: adminId });
    }
  }
  const byEmail = await collaboratorsByEmail();
  let imported = 0, skipped = 0, failed = 0, invoices = 0, collections = 0;
  const t0 = Date.now();
  for (const p of plan.projects) {
    try {
      const r = await importProject(adminId, p, byEmail);
      if (r.status === "imported") { imported++; invoices += r.invoices; collections += r.collections; } else skipped++;
    } catch (e) {
      failed++;
      console.log(" ✖ importar", p.code, e instanceof Error ? e.message : e);
    }
  }
  console.log(`Importados ${imported}, omitidos ${skipped}, con error ${failed}; facturas ${invoices}, recaudos ${collections} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const v = await validateClosedMonths(adminId);
  console.log(`Meses validados ${v.validated.length}; errores ${v.errors.length}`, v.errors.slice(0, 3));
  const cmp = await comparePayments(plan.payments);
  console.log("Mapeo de códigos:", cmp.mapping, "Sin mapear:", cmp.unmapped);
  console.table(cmp.totals);
  const worst = [...cmp.rows].sort((a, b) => Math.abs(Number(b.difference)) - Math.abs(Number(a.difference))).slice(0, 12);
  console.table(worst.map((r) => ({ liquidacion: r.liquidation, colaborador: r.email.split("@")[0], calculado: Math.round(Number(r.calculated)), pagado: Math.round(Number(r.paid)), diferencia: Math.round(Number(r.difference)) })));
}
main().catch((e) => { console.error(e); process.exit(1); });
