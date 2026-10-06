/**
 * Datos de DEMOSTRACIÓN. Todos los nombres de clientes, proyectos y colaboradores (salvo el
 * registro de la política de gamificación) son ficticios. Se ejecuta con: npm run seed (solo contra el emulador de Firestore)
 *
 * Cubre: meses sobre y bajo la meta, un mes con ventas de exactamente $390M, proyectos con varios
 * colaboradores, recaudos parciales en distintos períodos, proyectos en USD y CLP, proyectos sin
 * colaboradores comisionables, facturas previstas, ajustes pendientes y a la colaboradora de gamificación.
 */
import bcrypt from "bcryptjs";
import { D } from "../src/domain/money";
import { monthKey, todayBogota, type DateOnly } from "../src/domain/dates";
import { validateMonth } from "../src/server/services/months";
import { approveSettlement, calculateDraft, personKey, registerPayment } from "../src/server/services/settlements";
import {
  C, audit, col, encodeKey, newId, now, peopleCol, ref, runTx,
  type AdjustmentDoc, type AssignmentDoc, type CollaboratorDoc, type CollectionDoc, type ExchangeRateDoc, type InvoiceDoc, type PersonSettlementDoc, type ProjectDoc,
} from "../src/store";
import { bootstrapBase } from "../src/store/bootstrap";


type Cur = "COP" | "USD" | "CLP" | "MXN";
type Country = "CO" | "CL" | "MX";

interface CollectionSpec {
  date: string;
  amount: string;
  fx?: string;
}
interface InvoiceSpec {
  number?: string; // sin número = factura prevista
  issueDate?: string;
  amount: string;
  collections?: CollectionSpec[];
}
interface ProjectSpec {
  code: string;
  client: string;
  country: Country;
  saleDate: string;
  currency: Cur;
  sale: string;
  costs: string;
  refRate?: string;
  expectedInvoices: number;
  assignments: [collaboratorKey: string, ratePercent: string][];
  invoices: InvoiceSpec[];
}

const COLLABORATORS = [
  { key: "nicholle", fullName: "Nicholle Torres", email: "nicholle.torres@demo.haptica.local", position: "Analista comercial", policy: "GAMIFICATION", joinDate: "2024-02-01", status: "ACTIVE" as const },
  { key: "laura", fullName: "Laura Mejía (demo)", email: "laura.mejia@demo.haptica.local", position: "Service Designer Senior", policy: "GENERAL", joinDate: "2022-06-15", status: "ACTIVE" as const },
  { key: "andres", fullName: "Andrés Rojas (demo)", email: "andres.rojas@demo.haptica.local", position: "Líder de Legal Service Design", policy: "GENERAL", joinDate: "2021-03-01", status: "ACTIVE" as const },
  { key: "camila", fullName: "Camila Duarte (demo)", email: "camila.duarte@demo.haptica.local", position: "Business Designer", policy: "GENERAL", joinDate: "2023-01-10", status: "ACTIVE" as const },
  { key: "sebastian", fullName: "Sebastián Ortiz (demo)", email: "sebastian.ortiz@demo.haptica.local", position: "Director de Cuentas", policy: "GENERAL", joinDate: "2020-09-01", status: "ACTIVE" as const },
  { key: "mateo", fullName: "Mateo Vargas (demo)", email: "mateo.vargas@demo.haptica.local", position: "Service Designer (retirado)", policy: "GENERAL", joinDate: "2022-01-03", status: "INACTIVE" as const },
];

const PROJECTS: ProjectSpec[] = [
  // ── Octubre 2025: 420 M (sobre la meta) ──
  { code: "HAP-2025-001", client: "Banco Ejemplo S.A.", country: "CO", saleDate: "2025-10-08", currency: "COP", sale: "180000000", costs: "20000000", expectedInvoices: 2, assignments: [["laura", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1001", issueDate: "2025-10-20", amount: "90000000", collections: [{ date: "2025-11-18", amount: "90000000" }] },
      { number: "FE-1008", issueDate: "2025-12-10", amount: "90000000", collections: [{ date: "2026-01-20", amount: "90000000" }] },
    ] },
  { code: "HAP-2025-002", client: "Aseguradora Demo S.A.S.", country: "CO", saleDate: "2025-10-22", currency: "COP", sale: "150000000", costs: "0", expectedInvoices: 3, assignments: [["andres", "0.8"], ["camila", "0.5"]],
    invoices: [
      { number: "FE-1004", issueDate: "2025-11-12", amount: "50000000", collections: [{ date: "2025-11-30", amount: "50000000" }] },
      { number: "FE-1030", issueDate: "2026-02-10", amount: "50000000", collections: [{ date: "2026-02-27", amount: "30000000" }] },
      { number: "FE-1066", issueDate: "2026-06-02", amount: "50000000", collections: [{ date: "2026-07-14", amount: "50000000" }] },
    ] },
  { code: "HAP-2025-003", client: "Comercializadora Sin Comisión Ltda.", country: "CO", saleDate: "2025-10-29", currency: "COP", sale: "90000000", costs: "0", expectedInvoices: 1, assignments: [],
    invoices: [{ number: "FE-1006", issueDate: "2025-11-05", amount: "90000000", collections: [{ date: "2025-12-02", amount: "90000000" }] }] },

  // ── Noviembre 2025: ≈300 M (bajo la meta) ──
  { code: "HAP-2025-004", client: "Tech Demo Inc.", country: "MX", saleDate: "2025-11-10", currency: "USD", sale: "40000", costs: "5000", refRate: "4100", expectedInvoices: 2, assignments: [["camila", "1"], ["sebastian", "0.7"]],
    invoices: [
      { number: "FE-1010", issueDate: "2025-11-25", amount: "20000", collections: [{ date: "2025-12-15", amount: "20000", fx: "4180" }] },
      { number: "FE-1027", issueDate: "2026-03-05", amount: "20000", collections: [{ date: "2026-03-28", amount: "10000", fx: "4050" }, { date: "2026-05-12", amount: "10000", fx: "4010" }] },
    ] },
  { code: "HAP-2025-005", client: "Clínica Demo S.A.", country: "CO", saleDate: "2025-11-20", currency: "COP", sale: "136000000", costs: "16000000", expectedInvoices: 1, assignments: [["nicholle", "1"], ["laura", "0.5"]],
    invoices: [{ number: "FE-1012", issueDate: "2025-12-01", amount: "136000000", collections: [{ date: "2026-01-15", amount: "136000000" }] }] },

  // ── Diciembre 2025: exactamente 390 M ──
  { code: "HAP-2025-006", client: "Constructora Demo S.A.S.", country: "CO", saleDate: "2025-12-02", currency: "COP", sale: "250000000", costs: "50000000", expectedInvoices: 2, assignments: [["andres", "1"], ["sebastian", "0.5"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1015", issueDate: "2025-12-15", amount: "150000000", collections: [{ date: "2026-02-10", amount: "150000000" }] },
      { number: "FE-1040", issueDate: "2026-04-10", amount: "100000000", collections: [{ date: "2026-05-20", amount: "70000000" }] },
    ] },
  { code: "HAP-2025-007", client: "Fundación Demo", country: "CO", saleDate: "2025-12-12", currency: "COP", sale: "140000000", costs: "0", expectedInvoices: 1, assignments: [["camila", "0.5"]],
    invoices: [{ number: "FE-1017", issueDate: "2025-12-20", amount: "140000000", collections: [{ date: "2026-01-30", amount: "140000000" }] }] },

  // ── Enero 2026: 470 M (120,5 %) ──
  { code: "HAP-2026-001", client: "Banco Ejemplo S.A.", country: "CO", saleDate: "2026-01-14", currency: "COP", sale: "300000000", costs: "45000000", expectedInvoices: 3, assignments: [["laura", "1"], ["camila", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1022", issueDate: "2026-01-30", amount: "100000000", collections: [{ date: "2026-03-10", amount: "100000000" }] },
      { number: "FE-1049", issueDate: "2026-05-05", amount: "100000000", collections: [{ date: "2026-06-20", amount: "100000000" }] },
      { number: "FE-1085", issueDate: "2026-08-20", amount: "100000000", collections: [{ date: "2026-09-25", amount: "100000000" }] },
    ] },
  { code: "HAP-2026-002", client: "Telco Demo S.A.", country: "CO", saleDate: "2026-01-27", currency: "COP", sale: "170000000", costs: "30000000", expectedInvoices: 1, assignments: [["sebastian", "1"]],
    invoices: [{ number: "FE-1026", issueDate: "2026-02-05", amount: "170000000", collections: [{ date: "2026-04-08", amount: "170000000" }] }] },

  // ── Febrero 2026: ≈279 M (71,6 %) ──
  { code: "HAP-2026-003", client: "Utility Demo S.A. E.S.P.", country: "CO", saleDate: "2026-02-09", currency: "COP", sale: "200000000", costs: "20000000", expectedInvoices: 1, assignments: [["andres", "1"], ["nicholle", "1"]],
    invoices: [{ number: "FE-1032", issueDate: "2026-02-20", amount: "200000000", collections: [{ date: "2026-04-30", amount: "200000000" }] }] },
  { code: "HAP-2026-004", client: "Retail Demo Chile SpA", country: "CL", saleDate: "2026-02-23", currency: "CLP", sale: "18000000", costs: "0", refRate: "4.40", expectedInvoices: 1, assignments: [["laura", "0.6"]],
    invoices: [{ number: "FE-1035", issueDate: "2026-03-02", amount: "18000000", collections: [{ date: "2026-04-15", amount: "18000000", fx: "4.55" }] }] },

  // ── Marzo 2026: 250 M (64 %) ──
  { code: "HAP-2026-005", client: "Seguros Demo S.A.", country: "CO", saleDate: "2026-03-11", currency: "COP", sale: "250000000", costs: "0", expectedInvoices: 2, assignments: [["camila", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1038", issueDate: "2026-03-25", amount: "125000000", collections: [{ date: "2026-05-15", amount: "125000000" }] },
      { number: "FE-1090", issueDate: "2026-09-10", amount: "125000000" },
    ] },

  // ── Abril 2026: 400 M (102,6 %) ──
  { code: "HAP-2026-006", client: "Fintech Demo S.A.S.", country: "CO", saleDate: "2026-04-07", currency: "COP", sale: "260000000", costs: "60000000", expectedInvoices: 2, assignments: [["andres", "1"], ["sebastian", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1044", issueDate: "2026-04-20", amount: "130000000", collections: [{ date: "2026-06-02", amount: "130000000" }] },
      { number: "FE-1071", issueDate: "2026-07-15", amount: "130000000" },
    ] },
  { code: "HAP-2026-007", client: "Universidad Demo", country: "CO", saleDate: "2026-04-22", currency: "COP", sale: "140000000", costs: "10000000", expectedInvoices: 1, assignments: [["laura", "0.5"]],
    invoices: [{ number: "FE-1047", issueDate: "2026-05-02", amount: "140000000", collections: [{ date: "2026-05-28", amount: "140000000" }] }] },

  // ── Mayo 2026: 350 M (89,7 %) ──
  { code: "HAP-2026-008", client: "Banco Ejemplo S.A.", country: "CO", saleDate: "2026-05-06", currency: "COP", sale: "350000000", costs: "70000000", expectedInvoices: 3, assignments: [["laura", "1"], ["camila", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1052", issueDate: "2026-05-20", amount: "150000000", collections: [{ date: "2026-07-02", amount: "150000000" }] },
      { number: "FE-1074", issueDate: "2026-08-01", amount: "100000000", collections: [{ date: "2026-09-03", amount: "60000000" }] },
      { amount: "100000000" },
    ] },

  // ── Junio 2026: 520 M (133 %) ──
  { code: "HAP-2026-009", client: "Entidad Pública Demo", country: "CO", saleDate: "2026-06-03", currency: "COP", sale: "400000000", costs: "100000000", expectedInvoices: 2, assignments: [["andres", "1"], ["sebastian", "1"], ["nicholle", "1"]],
    invoices: [
      { number: "FE-1060", issueDate: "2026-06-20", amount: "200000000", collections: [{ date: "2026-08-18", amount: "200000000" }] },
      { number: "FE-1088", issueDate: "2026-09-15", amount: "200000000" },
    ] },
  { code: "HAP-2026-010", client: "Retail Demo S.A.", country: "CO", saleDate: "2026-06-18", currency: "COP", sale: "120000000", costs: "0", expectedInvoices: 1, assignments: [["camila", "0.8"]],
    invoices: [{ number: "FE-1068", issueDate: "2026-07-01", amount: "120000000", collections: [{ date: "2026-09-29", amount: "120000000" }] }] },

  // ── Julio 2026: 380 M (97,4 %) ──
  { code: "HAP-2026-011", client: "Aerolínea Demo", country: "MX", saleDate: "2026-07-06", currency: "USD", sale: "60000", costs: "10000", refRate: "4000", expectedInvoices: 1, assignments: [["sebastian", "1"], ["laura", "0.5"]],
    invoices: [{ number: "FE-1072", issueDate: "2026-07-30", amount: "60000", collections: [{ date: "2026-09-10", amount: "30000", fx: "3950" }] }] },
  { code: "HAP-2026-012", client: "Salud Demo IPS", country: "CO", saleDate: "2026-07-21", currency: "COP", sale: "140000000", costs: "20000000", expectedInvoices: 2, assignments: [["nicholle", "1"]],
    invoices: [{ amount: "70000000" }, { amount: "70000000" }] },

  // ── Agosto 2026: 450 M (115 %) ──
  { code: "HAP-2026-013", client: "Alcaldía Demo", country: "CO", saleDate: "2026-08-11", currency: "COP", sale: "450000000", costs: "90000000", expectedInvoices: 3, assignments: [["andres", "1"], ["camila", "0.7"], ["nicholle", "1"], ["laura", "0.5"]],
    invoices: [{ number: "FE-1083", issueDate: "2026-09-01", amount: "180000000" }] },

  // ── Septiembre 2026: 410 M (105 %) ──
  { code: "HAP-2026-014", client: "Banco Ejemplo S.A.", country: "CO", saleDate: "2026-09-02", currency: "COP", sale: "300000000", costs: "40000000", expectedInvoices: 2, assignments: [["laura", "1"], ["sebastian", "0.5"]], invoices: [] },
  { code: "HAP-2026-015", client: "Retail Demo S.A.", country: "CO", saleDate: "2026-09-24", currency: "COP", sale: "110000000", costs: "0", expectedInvoices: 1, assignments: [["camila", "1"]], invoices: [] },

  // ── Octubre 2026 (mes en curso, sin validar) ──
  { code: "HAP-2026-016", client: "Fintech Demo S.A.S.", country: "CO", saleDate: "2026-10-02", currency: "COP", sale: "95000000", costs: "5000000", expectedInvoices: 1, assignments: [["andres", "1"]], invoices: [] },
];


/** El seed BORRA todos los datos: solo se permite contra el emulador de Firestore. */
function assertEmulator() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("El seed borra TODOS los datos y solo funciona contra el emulador de Firestore (define FIRESTORE_EMULATOR_HOST, p. ej. 127.0.0.1:8085 con «npm run emulator»). Para producción usa «npm run bootstrap».");
  }
}

async function main() {
  assertEmulator();
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Define ADMIN_EMAIL y ADMIN_PASSWORD (p. ej. en .env.local) antes de ejecutar el seed.");
  const projectId = process.env.GCLOUD_PROJECT ?? "haptica-commission-manager";

  // Limpieza total del emulador.
  const wipe = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!wipe.ok) throw new Error(`No se pudo limpiar el emulador (${wipe.status}). ¿Está en ejecución?`);

  await bootstrapBase({ email, name: process.env.ADMIN_NAME ?? "Administrador", passwordHash: await bcrypt.hash(password, 12) });
  const adminId = (await col(C.users).where("email", "==", email).limit(1).get()).docs[0].id;

  const stamp = (id: string | null = adminId) => {
    const t = now();
    return { createdAt: t, updatedAt: t, createdById: id, updatedById: id };
  };
  const claim = async (key: string, owner: string) => {
    const id = encodeKey(key);
    await ref(C.uniques, id).set({ id, key, ref: owner, createdAt: now() });
  };
  const log = (entity: string, entityId: string, summary: string) => runTx(async (tx) => void audit(tx, { entity, entityId, action: "CREATE", summary, userId: adminId }));

  const collab: Record<string, string> = {};
  for (const c of COLLABORATORS) {
    const id = newId();
    const doc: CollaboratorDoc = {
      id, fullName: c.fullName, email: c.email, position: c.position, status: c.status, policyId: c.policy as CollaboratorDoc["policyId"],
      joinDate: c.joinDate as DateOnly, notes: c.status === "INACTIVE" ? "Colaborador retirado: conserva el historial y sus derechos económicos." : null, ...stamp(),
    };
    await ref(C.collaborators, id).set(doc);
    await claim(`email:${c.email}`, `${C.collaborators}/${id}`);
    collab[c.key] = id;
  }

  // Tasas del día usadas en el demo (catálogo para autocompletar).
  const rates = new Map<string, ExchangeRateDoc>();
  const addRate = (currency: Cur, date: string, rate: string) => {
    if (currency === "COP") return;
    const id = `${currency}_${date}`;
    rates.set(id, { id, currency, date: date as DateOnly, rate, source: "TRM (demo)", notes: null, createdAt: now(), createdById: adminId });
  };

  for (const p of PROJECTS) {
    const refRate = p.currency === "COP" ? "1" : p.refRate!;
    const netBase = D(p.sale).minus(p.costs);
    if (p.currency !== "COP") addRate(p.currency, p.saleDate, refRate);
    const t = now();

    const assignments: AssignmentDoc[] = p.assignments.map(([key, pct]) => {
      const rate = D(pct).div(100).toFixed();
      return { id: newId(), collaboratorId: collab[key], baseRate: rate, effectiveRate: null, effectiveRateRule: null, removedAt: null, removedReason: null, versions: [{ baseRate: rate, reason: "Asignación inicial en la venta", createdAt: t, createdById: adminId }], createdAt: t };
    });
    const project: ProjectDoc = {
      id: p.code, code: p.code, client: p.client, country: p.country, saleDate: p.saleDate as DateOnly, saleMonth: monthKey(p.saleDate as DateOnly),
      currency: p.currency, saleAmount: D(p.sale).toFixed(), providerCosts: D(p.costs).toFixed(), netBase: netBase.toFixed(), saleReferenceRate: D(refRate).toFixed(),
      saleAmountCOP: D(p.sale).mul(refRate).toFixed(), expectedInvoices: p.expectedInvoices, notes: null, assignments,
      collaboratorIds: assignments.map((a) => a.collaboratorId), everAssignedIds: [...new Set(assignments.map((a) => a.collaboratorId))],
      voidedAt: null, voidedById: null, voidReason: null, ...stamp(),
    };
    await ref(C.projects, p.code).set(project);
    await log("Project", p.code, `Proyecto ${p.code} creado (datos de demostración)`);

    for (const inv of p.invoices) {
      const id = newId();
      const collections: CollectionDoc[] = (inv.collections ?? []).map((c) => {
        const fx = p.currency === "COP" ? "1" : c.fx!;
        addRate(p.currency, c.date, fx);
        return {
          id: newId(), date: c.date as DateOnly, amountReceived: D(c.amount).toFixed(), currency: p.currency, fxRate: D(fx).toFixed(), amountCOP: D(c.amount).mul(fx).toFixed(),
          isOverpaymentAdjustment: false, justification: null, notes: null, voidedAt: null, voidedById: null, voidReason: null, ...stamp(),
        };
      });
      const invoice: InvoiceDoc = {
        id, projectId: p.code, number: inv.number ?? null, issueDate: (inv.issueDate ?? null) as DateOnly | null, currency: p.currency, amountPreTax: D(inv.amount).toFixed(),
        netBaseExplicit: null, status: inv.number ? "ISSUED" : "PLANNED", dueDate: (inv.issueDate ? addDays(inv.issueDate, 30) : null) as DateOnly | null, notes: null,
        collections, collectionIds: collections.map((c) => c.id), voidedAt: null, voidedById: null, voidReason: null, ...stamp(),
      };
      await ref(C.invoices, id).set(invoice);
      if (inv.number) await claim(`invoice:${p.code}:${inv.number}`, `${C.invoices}/${id}`);
    }
  }
  for (const r of rates.values()) await ref(C.exchangeRates, r.id).set(r);

  // Valida los meses ya cerrados con el mismo servicio de la aplicación (el mes en curso queda abierto).
  const today = todayBogota();
  const months = [...new Set(PROJECTS.map((p) => monthKey(p.saleDate as DateOnly)))].sort();
  for (const ym of months) if (ym < monthKey(today)) await runTx((tx) => validateMonth(tx, ym, adminId, today));

  // Cierra la liquidación de abril 2026 con el mismo servicio de la aplicación y registra pagos de ejemplo.
  // Las alertas de advertencia se reconocen como lo haría el administrador.
  const apr = await runTx((tx) => calculateDraft(tx, 2026, "APRIL", adminId));
  const ack = apr.result.alerts.filter((a) => a.severity === "WARNING").map((a) => a.key);
  await approveSettlement(apr.settlementId, adminId, ack);
  const people = (await peopleCol(apr.settlementId).get()).docs.map((d) => d.data() as PersonSettlementDoc);
  for (const cs of people) {
    const net = D(cs.netPayable);
    if (net.isZero()) continue;
    const name = (await ref(C.collaborators, cs.collaboratorId).get()).data() as CollaboratorDoc;
    // Laura queda con pago parcial; el resto, pagado.
    const amount = name.fullName.startsWith("Laura") ? net.div(2).toDecimalPlaces(2) : net.toDecimalPlaces(2);
    await runTx((tx) => registerPayment(tx, personKey(apr.settlementId, cs.collaboratorId), { paidAt: "2026-04-15", amount: amount.toFixed(), reference: `DEMO-${name.fullName.slice(0, 3).toUpperCase()}-0415` }, adminId));
  }

  // Ajustes pendientes de ejemplo (creados DESPUÉS de cerrar abril: la nota crédito se compensa en la liquidación de octubre).
  const inv30 = (await col(C.invoices).where("projectId", "==", "HAP-2026-001").get()).docs.map((d) => d.data() as InvoiceDoc).find((i) => i.number === "FE-1022");
  const adjustment = (projectId: string, over: Partial<AdjustmentDoc>): AdjustmentDoc => ({
    id: newId(), projectId, invoiceId: null, date: "2026-08-10" as DateOnly, kind: "CREDIT_NOTE", reason: "", amount: "0", currency: "COP", status: "PENDING", appliedInSettlementId: null,
    voidedAt: null, voidedById: null, voidReason: null, createdAt: now(), createdById: adminId, ...over,
  });
  for (const a of [
    adjustment("HAP-2026-001", { invoiceId: inv30?.id ?? null, date: "2026-08-10" as DateOnly, kind: "CREDIT_NOTE", reason: "Nota crédito por descuento comercial pactado con el cliente después del cierre de abril", amount: "10000000" }),
    adjustment("HAP-2026-009", { date: "2026-09-20" as DateOnly, kind: "PROVIDER_COST", reason: "Costo adicional de proveedor facturado después del cierre del proyecto", amount: "8000000" }),
  ]) {
    await ref(C.adjustments, a.id).set(a);
  }

  console.log(`Seed completado: ${PROJECTS.length} proyectos, ${COLLABORATORS.length} colaboradores. Usuario administrador: ${email}`);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
