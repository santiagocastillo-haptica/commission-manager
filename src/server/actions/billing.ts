"use server";

import { revalidatePath } from "next/cache";
import { isDateOnly, todayBogota, type DateOnly } from "@/domain/dates";
import { D, formatMoney, type CurrencyCode } from "@/domain/money";
import { DomainError } from "@/domain/project";
import {
  adjustmentSchema,
  collectionSchema,
  fxRateString,
  invoiceSchema,
  voidSchema,
  type AdjustmentInput,
  type CollectionInput,
  type InvoiceInput,
} from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import {
  C, assertNotClosing, audit, col, isSettled, newId, now, prepareUniques, ref, runTx,
  type AdjustmentDoc, type CollectionDoc, type ExchangeRateDoc, type InvoiceDoc, type ProjectDoc,
} from "@/store";
import { requireSession } from "../auth";

function revalidateBilling(projectId?: string) {
  revalidatePath("/");
  revalidatePath("/proyectos");
  revalidatePath("/facturas");
  if (projectId) revalidatePath(`/proyectos/${projectId}`);
}

const liveCollections = (i: InvoiceDoc) => i.collections.filter((c) => !c.voidedAt);
const sumReceived = (list: CollectionDoc[]) => list.reduce((acc, c) => acc.plus(c.amountReceived), D(0));
const withoutCollections = (i: InvoiceDoc) => ({ ...i, collections: undefined });

// ───────────── Facturas ─────────────

export async function saveInvoiceAction(id: string | null, input: InvoiceInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  try {
    const data = invoiceSchema.parse(input);
    const invoiceId = id ?? newId();

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const projectSnap = await tx.get(ref(C.projects, data.projectId));
      if (!projectSnap.exists) throw new DomainError("El proyecto no existe.");
      const project = projectSnap.data() as ProjectDoc;
      if (project.voidedAt) throw new DomainError("El proyecto está anulado.");

      const snap = await tx.get(ref(C.invoices, invoiceId));
      const before = snap.exists ? (snap.data() as InvoiceDoc) : null;
      if (id && !before) throw new DomainError("La factura no existe.");
      if (before?.voidedAt) throw new DomainError("La factura está anulada y no se puede modificar.");
      if (before && before.projectId !== data.projectId) throw new DomainError("No se puede mover una factura a otro proyecto.");

      const siblings = (await tx.get(col(C.invoices).where("projectId", "==", project.id))).docs
        .map((d) => d.data() as InvoiceDoc)
        .filter((i) => !i.voidedAt && i.id !== invoiceId);
      const others = siblings.reduce((acc, i) => acc.plus(i.amountPreTax), D(0));
      if (others.plus(data.amountPreTax).gt(project.saleAmount)) {
        const left = D(project.saleAmount).minus(others);
        throw new DomainError(`La suma de las facturas supera el valor de la venta. Disponible para facturar: ${formatMoney(left, project.currency as CurrencyCode)}.`);
      }

      if (before) {
        const collected = sumReceived(liveCollections(before));
        if (D(data.amountPreTax).lt(collected)) {
          throw new DomainError(`La factura ya tiene recaudos por ${formatMoney(collected, project.currency as CurrencyCode)}; el valor no puede ser menor.`);
        }
        if (data.status === "PLANNED" && before.collections.some((c) => !c.voidedAt)) {
          throw new DomainError("Una factura con recaudos no puede volver a estado «prevista».");
        }
        const settled = await isSettled(tx, "invoiceId", invoiceId);
        const explicitChanged = (before.netBaseExplicit ? D(before.netBaseExplicit).toFixed() : null) !== (data.netBaseExplicit ? D(data.netBaseExplicit).toFixed() : null);
        if (
          settled &&
          (!D(before.amountPreTax).equals(data.amountPreTax) ||
            explicitChanged ||
            data.status !== before.status ||
            (before.issueDate && data.issueDate !== before.issueDate))
        ) {
          throw new DomainError("La factura tiene comisiones ya liquidadas: su valor, base neta, estado y fecha de emisión no se pueden modificar. Registra un ajuste.");
        }
      }

      const number = data.number || null;
      const applyUniques = await prepareUniques(
        tx,
        number ? [{ key: `invoice:${project.id}:${number}`, owner: `${C.invoices}/${invoiceId}`, message: "Ya existe una factura con ese número en este proyecto." }] : [],
        before?.number && before.number !== number ? [`invoice:${project.id}:${before.number}`] : [],
      );

      const t = now();
      const doc: InvoiceDoc = {
        id: invoiceId,
        projectId: project.id,
        number,
        status: data.status,
        issueDate: (data.issueDate || null) as DateOnly | null,
        dueDate: (data.dueDate || null) as DateOnly | null,
        currency: project.currency,
        amountPreTax: D(data.amountPreTax).toFixed(),
        netBaseExplicit: data.netBaseExplicit ? D(data.netBaseExplicit).toFixed() : null,
        notes: data.notes || null,
        collections: before?.collections ?? [],
        collectionIds: before?.collectionIds ?? [],
        voidedAt: null, voidedById: null, voidReason: null,
        createdAt: before?.createdAt ?? t, createdById: before?.createdById ?? session.userId, updatedAt: t, updatedById: session.userId,
      };
      applyUniques(tx);
      tx.set(ref(C.invoices, invoiceId), doc);
      audit(tx, {
        entity: "Invoice", entityId: invoiceId, action: id ? "UPDATE" : "CREATE",
        summary: `${id ? "Factura actualizada" : "Factura registrada"}: ${doc.number ?? "prevista"} · proyecto ${project.code}`,
        before: before ? withoutCollections(before) : undefined, after: withoutCollections(doc), userId: session.userId,
      });
    });
    revalidateBilling(data.projectId);
    return ok({ id: invoiceId }, id ? "Factura actualizada." : "Factura registrada.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function voidInvoiceAction(input: { id: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const { id, reason } = voidSchema.parse(input);
    let projectId = "";
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.invoices, id));
      if (!snap.exists) throw new DomainError("La factura no existe.");
      const inv = snap.data() as InvoiceDoc;
      projectId = inv.projectId;
      if (inv.voidedAt) throw new DomainError("La factura ya está anulada.");
      if (inv.collections.some((c) => !c.voidedAt)) throw new DomainError("La factura tiene recaudos. Anúlalos primero.");
      const adjustments = await tx.get(col(C.adjustments).where("invoiceId", "==", id));
      if (adjustments.docs.some((d) => !(d.data() as AdjustmentDoc).voidedAt)) {
        throw new DomainError("La factura tiene ajustes registrados. Anúlalos primero (o regístralos sobre el proyecto).");
      }
      const after: InvoiceDoc = { ...inv, voidedAt: now(), voidedById: session.userId, voidReason: reason, updatedAt: now(), updatedById: session.userId };
      tx.set(ref(C.invoices, id), after);
      audit(tx, { entity: "Invoice", entityId: id, action: "VOID", summary: `Factura ${inv.number ?? "prevista"} anulada. Motivo: ${reason}`, before: withoutCollections(inv), after: withoutCollections(after), userId: session.userId });
    });
    revalidateBilling(projectId);
    return ok(undefined, "Factura anulada.");
  } catch (e) {
    return toFailure(e);
  }
}

// ───────────── Recaudos ─────────────

export async function saveCollectionAction(id: string | null, input: CollectionInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  try {
    const data = collectionSchema.parse(input);
    const today = todayBogota();
    if (data.date > today) throw new DomainError("La fecha del recaudo no puede ser futura.");
    const collectionId = id ?? newId();
    let projectId = "";

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const invSnap = await tx.get(ref(C.invoices, data.invoiceId));
      if (!invSnap.exists) throw new DomainError("La factura no existe.");
      const invoice = invSnap.data() as InvoiceDoc;
      projectId = invoice.projectId;
      const project = (await tx.get(ref(C.projects, invoice.projectId))).data() as ProjectDoc;
      if (invoice.voidedAt || project.voidedAt) throw new DomainError("La factura o el proyecto están anulados.");
      if (invoice.status !== "ISSUED" || !invoice.issueDate) throw new DomainError("Solo se pueden registrar recaudos sobre facturas emitidas.");
      if (data.date < invoice.issueDate) throw new DomainError("La fecha del recaudo no puede ser anterior a la fecha de emisión de la factura.");

      const before = id ? (invoice.collections.find((c) => c.id === id) ?? null) : null;
      if (id && !before) {
        throw new DomainError(invoice.collectionIds.includes(id) ? "El recaudo no existe." : "El recaudo no pertenece a esa factura.");
      }
      if (before?.voidedAt) throw new DomainError("El recaudo está anulado y no se puede modificar.");
      if (before && (await isSettled(tx, "collectionId", collectionId))) {
        throw new DomainError("Este recaudo ya fue liquidado y es inmutable. Para corregirlo registra un ajuste.");
      }

      const currency = invoice.currency as CurrencyCode;
      let fx = D(1);
      if (currency !== "COP") {
        const parsed = fxRateString.safeParse(data.fxRate ?? "");
        if (!parsed.success) throw new DomainError("Ingresa la TRM del día del recaudo: es necesaria para convertir la comisión a COP.");
        fx = D(parsed.data);
        if (fx.equals(1)) throw new DomainError("Una TRM de 1 no es válida para moneda extranjera. Ingresa la TRM del día del recaudo.");
      }

      const othersTotal = sumReceived(liveCollections(invoice).filter((c) => c.id !== id));
      const total = othersTotal.plus(data.amountReceived);
      const exceeds = total.gt(invoice.amountPreTax);
      if (exceeds && !data.isOverpaymentAdjustment) {
        const left = D(invoice.amountPreTax).minus(othersTotal);
        throw new DomainError(`No se puede recaudar más del valor facturado. Saldo pendiente: ${formatMoney(left, currency)}. Si corresponde a un excedente real, márcalo como ajuste y justifícalo.`);
      }

      // Historial de tasas: se conserva la tasa usada y se agrega al catálogo si no existía para ese día.
      const rateId = `${currency}_${data.date}`;
      const rateExists = currency === "COP" ? true : (await tx.get(ref(C.exchangeRates, rateId))).exists;

      const t = now();
      const collection: CollectionDoc = {
        id: collectionId,
        date: data.date as DateOnly,
        amountReceived: D(data.amountReceived).toFixed(),
        currency: invoice.currency,
        fxRate: fx.toFixed(),
        amountCOP: D(data.amountReceived).mul(fx).toFixed(),
        isOverpaymentAdjustment: exceeds,
        justification: exceeds ? (data.justification ?? null) : null,
        notes: data.notes || null,
        voidedAt: null, voidedById: null, voidReason: null,
        createdAt: before?.createdAt ?? t, createdById: before?.createdById ?? session.userId, updatedAt: t, updatedById: session.userId,
      };
      const collections = before ? invoice.collections.map((c) => (c.id === collectionId ? collection : c)) : [...invoice.collections, collection];
      tx.set(ref(C.invoices, invoice.id), { ...invoice, collections, collectionIds: collections.map((c) => c.id), updatedAt: t });

      if (!rateExists) {
        const rate: ExchangeRateDoc = { id: rateId, currency: currency as "USD" | "CLP" | "MXN", date: data.date as DateOnly, rate: fx.toFixed(), source: "Registrada en un recaudo", notes: null, createdAt: t, createdById: session.userId };
        tx.create(ref(C.exchangeRates, rateId), rate);
      }
      audit(tx, {
        entity: "Collection", entityId: collectionId, action: id ? "UPDATE" : "CREATE",
        summary: `${id ? "Recaudo actualizado" : "Recaudo registrado"}: ${formatMoney(data.amountReceived, currency)} · factura ${invoice.number} · proyecto ${project.code}${currency !== "COP" ? ` · TRM ${fx.toFixed()}` : ""}`,
        before: before ?? undefined, after: collection, userId: session.userId,
      });
    });
    revalidateBilling(projectId);
    return ok({ id: collectionId }, id ? "Recaudo actualizado." : "Recaudo registrado.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function voidCollectionAction(input: { id: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const { id, reason } = voidSchema.parse(input);
    let projectId = "";
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const found = await tx.get(col(C.invoices).where("collectionIds", "array-contains", id).limit(1));
      if (found.empty) throw new DomainError("El recaudo no existe.");
      const invoice = found.docs[0].data() as InvoiceDoc;
      projectId = invoice.projectId;
      const c = invoice.collections.find((x) => x.id === id)!;
      if (c.voidedAt) throw new DomainError("El recaudo ya está anulado.");
      if (await isSettled(tx, "collectionId", id)) throw new DomainError("Este recaudo ya fue liquidado y no se puede anular. Registra un ajuste.");
      const t = now();
      const after: CollectionDoc = { ...c, voidedAt: t, voidedById: session.userId, voidReason: reason, updatedAt: t, updatedById: session.userId };
      tx.set(ref(C.invoices, invoice.id), { ...invoice, collections: invoice.collections.map((x) => (x.id === id ? after : x)), updatedAt: t });
      audit(tx, { entity: "Collection", entityId: id, action: "VOID", summary: `Recaudo de ${formatMoney(c.amountReceived, c.currency as CurrencyCode)} anulado (factura ${invoice.number}). Motivo: ${reason}`, before: c, after, userId: session.userId });
    });
    revalidateBilling(projectId);
    return ok(undefined, "Recaudo anulado.");
  } catch (e) {
    return toFailure(e);
  }
}

/** Autocompleta la TRM guardada para una moneda y fecha (si existe). */
export async function lookupRateAction(currency: string, date: string): Promise<string | null> {
  await requireSession();
  if (!["USD", "CLP", "MXN"].includes(currency) || !isDateOnly(date)) return null;
  const snap = await ref(C.exchangeRates, `${currency}_${date}`).get();
  return snap.exists ? D((snap.data() as ExchangeRateDoc).rate).toFixed() : null;
}

// ───────────── Ajustes ─────────────

export async function saveAdjustmentAction(input: AdjustmentInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  try {
    const data = adjustmentSchema.parse(input);
    const adjId = newId();
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const projectSnap = await tx.get(ref(C.projects, data.projectId));
      if (!projectSnap.exists) throw new DomainError("El proyecto no existe.");
      const project = projectSnap.data() as ProjectDoc;
      if (project.voidedAt) throw new DomainError("El proyecto está anulado.");
      if (data.invoiceId) {
        const inv = await tx.get(ref(C.invoices, data.invoiceId));
        if (!inv.exists || (inv.data() as InvoiceDoc).projectId !== project.id) throw new DomainError("La factura no pertenece a este proyecto.");
      }
      const previous = (await tx.get(col(C.adjustments).where("projectId", "==", project.id))).docs.map((d) => d.data() as AdjustmentDoc).filter((a) => !a.voidedAt);
      const reduced = previous.reduce((acc, a) => acc.plus(a.amount), D(0)).plus(data.amount);
      if (reduced.gt(project.netBase)) {
        throw new DomainError("Los ajustes acumulados no pueden superar la base neta comisionable del proyecto.");
      }
      const adj: AdjustmentDoc = {
        id: adjId, projectId: project.id, invoiceId: data.invoiceId || null, date: data.date as DateOnly, kind: data.kind, reason: data.reason,
        amount: D(data.amount).toFixed(), currency: project.currency, status: "PENDING", appliedInSettlementId: null,
        voidedAt: null, voidedById: null, voidReason: null, createdAt: now(), createdById: session.userId,
      };
      tx.create(ref(C.adjustments, adjId), adj);
      audit(tx, { entity: "Adjustment", entityId: adjId, action: "CREATE", summary: `Ajuste registrado en ${project.code}: −${formatMoney(data.amount, project.currency as CurrencyCode)} (${data.kind}). ${data.reason}`, after: adj, userId: session.userId });
    });
    revalidateBilling(data.projectId);
    return ok({ id: adjId }, "Ajuste registrado. Se aplicará en la siguiente liquidación abierta.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function voidAdjustmentAction(input: { id: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const { id, reason } = voidSchema.parse(input);
    let projectId = "";
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.adjustments, id));
      if (!snap.exists) throw new DomainError("El ajuste no existe.");
      const a = snap.data() as AdjustmentDoc;
      projectId = a.projectId;
      if (a.voidedAt) throw new DomainError("El ajuste ya está anulado.");
      if (a.status === "APPLIED" || (await isSettled(tx, "adjustmentId", id))) {
        throw new DomainError("El ajuste ya fue aplicado en una liquidación cerrada y no se puede anular.");
      }
      const after: AdjustmentDoc = { ...a, voidedAt: now(), voidedById: session.userId, voidReason: reason };
      tx.set(ref(C.adjustments, id), after);
      audit(tx, { entity: "Adjustment", entityId: id, action: "VOID", summary: `Ajuste anulado. Motivo: ${reason}`, before: a, after, userId: session.userId });
    });
    revalidateBilling(projectId);
    return ok(undefined, "Ajuste anulado.");
  } catch (e) {
    return toFailure(e);
  }
}
