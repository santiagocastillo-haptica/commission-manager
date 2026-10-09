import { formatMonth, monthKey, todayBogota } from "@/domain/dates";
import { D, ZERO } from "@/domain/money";
import { settlementPeriod, type SettlementPeriod } from "@/domain/periods";
import { computeNetBase, DomainError, saleAmountInCOP } from "@/domain/project";
import { calculateSettlement, type PriorCommit } from "@/domain/settlement";
import {
  C, assertNotClosing, audit, col, newId, now, prepareUniques, ref, runTx,
  type AdjustmentDoc, type AssignmentDoc, type CollaboratorDoc, type CollectionDoc, type InvoiceDoc, type MonthlySalesDoc, type ProjectDoc,
} from "@/store";
import { loadCommissionProjectsWith, plainReader } from "../commission-data";
import { validateMonth } from "../services/months";
import { STORAGE_SCALE } from "../services/settlements";
import type { HistoryPayment, HistoryProject } from "./history";

export interface ImportProjectResult {
  code: string;
  status: "imported" | "skipped";
  invoices: number;
  collections: number;
  message?: string;
}

/** Colaboradores existentes por correo (minúsculas). */
export async function collaboratorsByEmail(): Promise<Map<string, CollaboratorDoc>> {
  const docs = (await col(C.collaborators).get()).docs.map((d) => d.data() as CollaboratorDoc);
  return new Map(docs.map((c) => [c.email.toLowerCase(), c]));
}

/**
 * Carga UN proyecto con sus asignaciones, facturas, recaudos y ajustes en una sola transacción (todo o nada).
 * Es idempotente: si el proyecto ya existe no hace nada. Aplica las mismas reglas que las acciones de la aplicación.
 */
export async function importProject(userId: string, p: HistoryProject, byEmail: Map<string, CollaboratorDoc>): Promise<ImportProjectResult> {
  const saleMonth = monthKey(p.saleDate);
  const netBase = computeNetBase(p.sale, p.costs);
  const refRate = p.currency === "COP" ? D(1) : D(p.saleRate ?? 0);
  const saleCOP = saleAmountInCOP(p.sale, p.currency, refRate);
  const invoiced = p.invoices.reduce((acc, i) => acc.plus(i.amount), ZERO);
  if (invoiced.gt(p.sale)) throw new DomainError(`${p.code}: lo facturado (${invoiced.toFixed()}) supera el valor de la venta (${p.sale}).`);

  const people = p.assignments.map((a) => {
    const c = byEmail.get(a.email);
    if (!c) throw new DomainError(`${p.code}: el colaborador ${a.email} no existe en la aplicación. Créalo antes de importar.`);
    if (c.policyId === "GAMIFICATION" && !D(a.pct).equals(1)) throw new DomainError(`${p.code}: para ${c.fullName} (gamificación) el porcentaje base debe ser 1 %.`);
    return { c, a };
  });

  return runTx(async (tx) => {
    await assertNotClosing(tx);
    const existing = await tx.get(ref(C.projects, p.code));
    if (existing.exists) return { code: p.code, status: "skipped" as const, invoices: 0, collections: 0, message: "Ya existe" };
    const monthSnap = await tx.get(ref(C.monthlySales, saleMonth));
    if (monthSnap.exists && (monthSnap.data() as MonthlySalesDoc).status === "VALIDATED") {
      throw new DomainError(`${p.code}: el mes de venta (${formatMonth(saleMonth)}) ya está validado. Importa antes de validar los meses.`);
    }
    const invoiceIds = p.invoices.map(() => newId());
    const applyUniques = await prepareUniques(
      tx,
      p.invoices.flatMap((i, n) => (i.number ? [{ key: `invoice:${p.code}:${i.number}`, owner: `${C.invoices}/${invoiceIds[n]}`, message: `${p.code}: ya existe la factura ${i.number}.` }] : [])),
    );

    const t = now();
    const stamp = { createdAt: t, updatedAt: t, createdById: userId, updatedById: userId };
    const assignments: AssignmentDoc[] = people.map(({ c, a }) => {
      const rate = D(a.pct).div(100).toFixed();
      return {
        id: newId(), collaboratorId: c.id, baseRate: rate, effectiveRate: null, effectiveRateRule: null, removedAt: null, removedReason: null,
        versions: [{ baseRate: rate, reason: "Asignación inicial en la venta (importación de historia)", createdAt: t, createdById: userId }], createdAt: t,
      };
    });
    const project: ProjectDoc = {
      id: p.code, code: p.code, client: p.client, country: p.country as ProjectDoc["country"], saleDate: p.saleDate, saleMonth, currency: p.currency,
      saleAmount: D(p.sale).toFixed(), providerCosts: D(p.costs).toFixed(), netBase: netBase.toFixed(), saleReferenceRate: refRate.toFixed(), saleAmountCOP: saleCOP.toFixed(),
      expectedInvoices: p.expectedInvoices, notes: p.notes, assignments, collaboratorIds: assignments.map((a) => a.collaboratorId),
      everAssignedIds: [...new Set(assignments.map((a) => a.collaboratorId))], voidedAt: null, voidedById: null, voidReason: null, ...stamp,
    };
    tx.create(ref(C.projects, p.code), project);

    let collectionCount = 0;
    const invoiceIdByNumber = new Map<string, string>();
    for (const [n, i] of p.invoices.entries()) {
      const id = invoiceIds[n];
      if (i.number) invoiceIdByNumber.set(i.number, id);
      const collections: CollectionDoc[] = i.collections.map((c) => {
        const fx = p.currency === "COP" ? D(1) : D(c.fxRate ?? 0);
        collectionCount++;
        return {
          id: newId(), date: c.date, amountReceived: D(c.amount).toFixed(), currency: p.currency, fxRate: fx.toFixed(), amountCOP: D(c.amount).mul(fx).toFixed(),
          isOverpaymentAdjustment: c.isOverpayment, justification: c.justification, notes: c.notes, voidedAt: null, voidedById: null, voidReason: null, ...stamp,
        };
      });
      const invoice: InvoiceDoc = {
        id, projectId: p.code, number: i.number, issueDate: i.issueDate, currency: p.currency, amountPreTax: D(i.amount).toFixed(),
        netBaseExplicit: i.netBaseExplicit ? D(i.netBaseExplicit).toFixed() : null, status: i.status, dueDate: i.dueDate, notes: i.notes,
        collections, collectionIds: collections.map((c) => c.id), voidedAt: null, voidedById: null, voidReason: null, ...stamp,
      };
      tx.create(ref(C.invoices, id), invoice);
    }
    for (const j of p.adjustments) {
      const id = newId();
      const adj: AdjustmentDoc = {
        id, projectId: p.code, invoiceId: j.invoiceNumber ? (invoiceIdByNumber.get(j.invoiceNumber) ?? null) : null, date: j.date, kind: j.kind, reason: j.reason,
        amount: D(j.amount).toFixed(), currency: p.currency, status: "PENDING", appliedInSettlementId: null, voidedAt: null, voidedById: null, voidReason: null, createdAt: t, createdById: userId,
      };
      tx.create(ref(C.adjustments, id), adj);
    }

    applyUniques(tx);
    audit(tx, {
      entity: "Project", entityId: p.code, action: "CREATE", userId,
      summary: `Proyecto ${p.code} importado desde la plantilla de historia · ${p.invoices.length} factura(s), ${collectionCount} recaudo(s), ${p.adjustments.length} ajuste(s)`,
    });
    return { code: p.code, status: "imported" as const, invoices: p.invoices.length, collections: collectionCount };
  });
}

export interface ValidateMonthsResult {
  validated: string[];
  alreadyValidated: string[];
  errors: { yearMonth: string; message: string }[];
}

/** Valida en orden todos los meses ya terminados que tienen proyectos (de septiembre de 2024 al mes anterior al actual). */
export async function validateClosedMonths(userId: string, today: string = todayBogota()): Promise<ValidateMonthsResult> {
  const projects = (await col(C.projects).get()).docs.map((d) => d.data() as ProjectDoc).filter((p) => !p.voidedAt);
  const months = [...new Set(projects.map((p) => p.saleMonth))].sort();
  const current = monthKey(today);
  const status = new Map((await col(C.monthlySales).get()).docs.map((d) => [d.id, (d.data() as MonthlySalesDoc).status]));
  const result: ValidateMonthsResult = { validated: [], alreadyValidated: [], errors: [] };
  for (const ym of months) {
    if (ym >= current) continue;
    if (status.get(ym) === "VALIDATED") {
      result.alreadyValidated.push(ym);
      continue;
    }
    try {
      await runTx(async (tx) => {
        await assertNotClosing(tx);
        await validateMonth(tx, ym, userId, today);
      });
      result.validated.push(ym);
    } catch (e) {
      result.errors.push({ yearMonth: ym, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

// ───────── Comparación con lo pagado ─────────

export interface ComparisonRow {
  liquidation: string;
  email: string;
  name: string;
  calculated: string;
  paid: string;
  difference: string;
}
export interface PaymentComparison {
  rows: ComparisonRow[];
  mapping: Record<string, string>;
  totals: { liquidation: string; calculated: string; paid: string; difference: string }[];
  unmapped: string[];
}

/** «LIQ-2024-Q4» y «LIQ-2025-Q1» → LIQ-2025-04 (recaudos oct–mar); «Q2» y «Q3» → LIQ-AAAA-10 (recaudos abr–sep). Los códigos semestrales se respetan. */
export function liquidationForLabel(label: string): string | null {
  const s = /^LIQ-(\d{4})-(04|10)$/.exec(label);
  if (s) return label;
  const q = /^LIQ-(\d{4})-Q([1-4])$/.exec(label);
  if (!q) return null;
  const year = Number(q[1]);
  const n = Number(q[2]);
  if (n === 4) return `LIQ-${year + 1}-04`;
  if (n === 1) return `LIQ-${year}-04`;
  return `LIQ-${year}-10`; // Q2 y Q3
}

/**
 * Calcula, de forma secuencial y SIN guardar nada, lo que liquidaría la aplicación en cada semestre y lo compara con lo
 * realmente pagado. Cada semestre descuenta lo ya liquidado en los anteriores y arrastra los saldos negativos.
 */
export async function comparePayments(payments: HistoryPayment[], today: string = todayBogota()): Promise<PaymentComparison> {
  const projects = await loadCommissionProjectsWith(plainReader);
  const collabs = (await col(C.collaborators).get()).docs.map((d) => d.data() as CollaboratorDoc);
  const nameByEmail = new Map(collabs.map((c) => [c.email.toLowerCase(), c.fullName]));
  const emailById = new Map(collabs.map((c) => [c.id, c.email.toLowerCase()]));

  const periods: SettlementPeriod[] = [];
  const thisYear = Number(today.slice(0, 4));
  for (let y = 2024; y <= thisYear + 1; y++) for (const h of ["APRIL", "OCTOBER"] as const) {
    const p = settlementPeriod(y, h);
    if (p.periodStart <= today) periods.push(p);
  }
  periods.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

  const prior: PriorCommit[] = [];
  let carry: Record<string, string> = {};
  const calc = new Map<string, number>(); // `${código}|${correo}` → neto
  for (const period of periods) {
    const res = calculateSettlement({ period: { periodStart: period.periodStart, periodEnd: period.periodEnd }, projects, priorCommits: prior, carryovers: carry }, { storageScale: STORAGE_SCALE });
    for (const l of res.lines) if (l.type === "COLLECTION" && l.collectionId) prior.push({ collectionId: l.collectionId, assignmentId: l.assignmentId });
    carry = {};
    for (const t of res.totals) {
      const email = emailById.get(t.collaboratorId);
      if (!email) continue;
      calc.set(`${period.code}|${email}`, t.netPayable.toNumber());
      if (t.carryoverOut.isNegative()) carry[t.collaboratorId] = t.carryoverOut.toFixed();
    }
  }

  const paid = new Map<string, number>();
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const g of payments) {
    const code = liquidationForLabel(g.liquidation);
    if (!code) {
      if (!unmapped.includes(g.liquidation)) unmapped.push(g.liquidation);
      continue;
    }
    mapping[g.liquidation] = code;
    paid.set(`${code}|${g.email}`, (paid.get(`${code}|${g.email}`) ?? 0) + Number(g.amount));
  }

  const keys = [...new Set([...calc.keys(), ...paid.keys()])].sort();
  const rows: ComparisonRow[] = [];
  for (const k of keys) {
    const [liquidation, email] = k.split("|");
    const c = calc.get(k) ?? 0;
    const p = paid.get(k) ?? 0;
    if (c === 0 && p === 0) continue;
    rows.push({ liquidation, email, name: nameByEmail.get(email) ?? email, calculated: String(c), paid: String(p), difference: String(c - p) });
  }
  const totals = [...new Set(rows.map((r) => r.liquidation))].map((liquidation) => {
    const mine = rows.filter((r) => r.liquidation === liquidation);
    const calculated = mine.reduce((a, r) => a.plus(r.calculated), ZERO);
    const paidSum = mine.reduce((a, r) => a.plus(r.paid), ZERO);
    return { liquidation, calculated: calculated.toFixed(), paid: paidSum.toFixed(), difference: calculated.minus(paidSum).toFixed() };
  });
  return { rows, mapping, totals, unmapped };
}

// ───────── Arqueo trimestral ─────────

export const quarterOf = (date: string): string => `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;

export interface ArqueoQuarter {
  quarter: string;
  /** Lo que dice la plantilla. */
  plan: { sales: string; invoiced: string; collected: string; projects: number };
  /** Lo que hay en la aplicación. */
  app: { sales: string; invoiced: string; collected: string; projects: number };
  /** Comisión generada por los recaudos del trimestre (porcentajes efectivos vigentes) y lo pagado según la hoja de pagos. */
  commissionGenerated: string;
  commissionPaid: string;
}
export interface ArqueoPersonRow {
  quarter: string;
  email: string;
  name: string;
  generated: string;
  paid: string;
  difference: string;
}
export interface Arqueo {
  quarters: ArqueoQuarter[];
  people: ArqueoPersonRow[];
  notes: string[];
}

/**
 * Arqueo por trimestre (cortes exactos): ventas, facturado, recaudado y comisión generada en la aplicación frente a la
 * plantilla y a lo pagado. Los códigos de pago «LIQ-AAAA-Q#» se toman como el trimestre de los RECAUDOS que se pagaron.
 */
export async function arqueoByQuarter(projects: HistoryProject[], payments: HistoryPayment[], today: string = todayBogota()): Promise<Arqueo> {
  const add = (m: Map<string, ReturnType<typeof D>>, k: string, v: string | number) => m.set(k, (m.get(k) ?? ZERO).plus(v));
  const planSales = new Map<string, ReturnType<typeof D>>();
  const planInv = new Map<string, ReturnType<typeof D>>();
  const planCol = new Map<string, ReturnType<typeof D>>();
  const planCount = new Map<string, number>();
  for (const p of projects) {
    const q = quarterOf(p.saleDate);
    add(planSales, q, p.sale);
    planCount.set(q, (planCount.get(q) ?? 0) + 1);
    for (const i of p.invoices) {
      if (i.status === "ISSUED" && i.issueDate) add(planInv, quarterOf(i.issueDate), i.amount);
      for (const c of i.collections) add(planCol, quarterOf(c.date), c.amount);
    }
  }

  const appProjects = (await col(C.projects).get()).docs.map((d) => d.data() as ProjectDoc).filter((p) => !p.voidedAt);
  const appInvoices = (await col(C.invoices).get()).docs.map((d) => d.data() as InvoiceDoc).filter((i) => !i.voidedAt);
  const appSales = new Map<string, ReturnType<typeof D>>();
  const appInv = new Map<string, ReturnType<typeof D>>();
  const appCol = new Map<string, ReturnType<typeof D>>();
  const appCount = new Map<string, number>();
  for (const p of appProjects) {
    add(appSales, quarterOf(p.saleDate), p.saleAmountCOP);
    appCount.set(quarterOf(p.saleDate), (appCount.get(quarterOf(p.saleDate)) ?? 0) + 1);
  }
  for (const i of appInvoices) {
    if (i.status === "ISSUED" && i.issueDate) add(appInv, quarterOf(i.issueDate), i.amountPreTax);
    for (const c of i.collections) if (!c.voidedAt) add(appCol, quarterOf(c.date), c.amountCOP);
  }

  const commissionProjects = await loadCommissionProjectsWith(plainReader);
  const collabs = (await col(C.collaborators).get()).docs.map((d) => d.data() as CollaboratorDoc);
  const emailById = new Map(collabs.map((c) => [c.id, c.email.toLowerCase()]));
  const nameByEmail = new Map(collabs.map((c) => [c.email.toLowerCase(), c.fullName]));
  const res = calculateSettlement({ period: { periodStart: "2024-09-01", periodEnd: today }, projects: commissionProjects, priorCommits: [], carryovers: {} }, { storageScale: STORAGE_SCALE });
  const gen = new Map<string, ReturnType<typeof D>>();
  const genPerson = new Map<string, ReturnType<typeof D>>();
  for (const l of res.lines) {
    const date = l.detail.collectionDate ?? l.detail.invoiceDate;
    if (!date) continue;
    const q = quarterOf(date);
    add(gen, q, l.commissionCOP.toFixed());
    add(genPerson, `${q}|${emailById.get(l.collaboratorId) ?? l.collaboratorId}`, l.commissionCOP.toFixed());
  }

  const notes: string[] = [];
  const paidQ = new Map<string, ReturnType<typeof D>>();
  const paidPerson = new Map<string, ReturnType<typeof D>>();
  for (const g of payments) {
    const m = /^LIQ-(\d{4})-Q([1-4])$/.exec(g.liquidation);
    if (!m) {
      if (!notes.some((n) => n.includes(g.liquidation))) notes.push(`El código de pago «${g.liquidation}» no es trimestral (LIQ-AAAA-Q#): no se incluye en el arqueo trimestral.`);
      continue;
    }
    const q = `${m[1]}-Q${m[2]}`;
    add(paidQ, q, g.amount);
    add(paidPerson, `${q}|${g.email}`, g.amount);
  }

  const keys = [...new Set([...planSales.keys(), ...planInv.keys(), ...planCol.keys(), ...appSales.keys(), ...appInv.keys(), ...appCol.keys(), ...gen.keys(), ...paidQ.keys()])].sort();
  const z = (m: Map<string, ReturnType<typeof D>>, k: string) => (m.get(k) ?? ZERO).toFixed(2);
  const quarters: ArqueoQuarter[] = keys.map((q) => ({
    quarter: q,
    plan: { sales: z(planSales, q), invoiced: z(planInv, q), collected: z(planCol, q), projects: planCount.get(q) ?? 0 },
    app: { sales: z(appSales, q), invoiced: z(appInv, q), collected: z(appCol, q), projects: appCount.get(q) ?? 0 },
    commissionGenerated: z(gen, q),
    commissionPaid: z(paidQ, q),
  }));
  const pKeys = [...new Set([...genPerson.keys(), ...paidPerson.keys()])].sort();
  const people: ArqueoPersonRow[] = pKeys
    .map((k) => {
      const [quarter, email] = k.split("|");
      const g = genPerson.get(k) ?? ZERO;
      const p = paidPerson.get(k) ?? ZERO;
      return { quarter, email, name: nameByEmail.get(email) ?? email, generated: g.toFixed(2), paid: p.toFixed(2), difference: g.minus(p).toFixed(2) };
    })
    .filter((r) => !D(r.generated).isZero() || !D(r.paid).isZero());
  return { quarters, people, notes };
}
