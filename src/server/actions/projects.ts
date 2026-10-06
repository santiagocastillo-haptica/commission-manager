"use server";

import { revalidatePath } from "next/cache";
import { formatMonth, monthKey } from "@/domain/dates";
import { D } from "@/domain/money";
import { computeNetBase, DomainError, saleAmountInCOP } from "@/domain/project";
import { projectSchema, voidSchema, type ProjectInput } from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import {
  C, assertNotClosing, audit, col, isSettled, newId, now, ref, runTx,
  type AssignmentDoc, type CollaboratorDoc, type InvoiceDoc, type MonthlySalesDoc, type ProjectDoc,
} from "@/store";
import { requireSession } from "../auth";

const LOCKED = (ym: string) =>
  new DomainError(
    `El mes de venta (${formatMonth(ym)}) ya está validado y bloqueado. Para modificar sus proyectos hay que reabrir el mes con un motivo.`,
  );

function revalidateAll(projectId?: string) {
  revalidatePath("/");
  revalidatePath("/proyectos");
  revalidatePath("/facturas");
  revalidatePath("/colaboradores");
  if (projectId) revalidatePath(`/proyectos/${projectId}`);
}

const pct = (rate: string) => D(rate).mul(100).toFixed();

export async function saveProjectAction(
  id: string | null,
  input: ProjectInput,
  rateChangeReason?: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  try {
    const data = projectSchema.parse(input);
    const netBase = computeNetBase(data.saleAmount, data.providerCosts);
    const saleMonth = monthKey(data.saleDate);
    const refRate = data.currency === "COP" ? D(1) : D(data.saleReferenceRate!);
    const saleAmountCOP = saleAmountInCOP(data.saleAmount, data.currency, refRate);
    const reason = rateChangeReason?.trim() ?? "";
    const projectId = data.code; // el id del documento es el código

    await runTx(async (tx) => {
      await assertNotClosing(tx);

      // ───── Lecturas ─────
      const collabSnaps = await Promise.all(data.assignments.map((a) => tx.get(ref(C.collaborators, a.collaboratorId))));
      const byId = new Map<string, CollaboratorDoc>();
      for (const s of collabSnaps) if (s.exists) byId.set(s.id, s.data() as CollaboratorDoc);
      for (const a of data.assignments) {
        const c = byId.get(a.collaboratorId);
        if (!c) throw new DomainError("Uno de los colaboradores seleccionados no existe.");
        // Política de gamificación: solo se admite el 1 % base (decisión D4c); la escala se aplica sobre ese valor.
        if (c.policyId === "GAMIFICATION" && !D(a.ratePercent).equals(1)) {
          throw new DomainError(`Para ${c.fullName} (política de gamificación) el porcentaje base debe ser 1 %. La escala de cumplimiento se aplica sobre ese valor.`);
        }
      }

      const snap = await tx.get(ref(C.projects, projectId));
      const before = snap.exists ? (snap.data() as ProjectDoc) : null;
      if (id) {
        if (id !== data.code) throw new DomainError("El código del proyecto no se puede cambiar.");
        if (!before) throw new DomainError("El proyecto no existe.");
        if (before.voidedAt) throw new DomainError("El proyecto está anulado y no se puede modificar.");
      } else if (before) {
        throw new DomainError("Ya existe un proyecto con ese código.", );
      }

      const targetMonthSnap = await tx.get(ref(C.monthlySales, saleMonth));
      const targetMonth = targetMonthSnap.exists ? (targetMonthSnap.data() as MonthlySalesDoc) : null;
      const oldMonthSnap = before && before.saleMonth !== saleMonth ? await tx.get(ref(C.monthlySales, before.saleMonth)) : targetMonthSnap;
      const oldMonth = oldMonthSnap.exists ? (oldMonthSnap.data() as MonthlySalesDoc) : null;

      const invoices = before
        ? (await tx.get(col(C.invoices).where("projectId", "==", projectId))).docs.map((d) => d.data() as InvoiceDoc).filter((i) => !i.voidedAt)
        : [];

      const existing = before?.assignments ?? [];
      const incoming = new Map(data.assignments.map((a) => [a.collaboratorId, D(a.ratePercent).div(100)]));
      const toRetire = existing.filter((e) => !e.removedAt && !incoming.has(e.collaboratorId));
      const settledRetire = new Set<string>();
      for (const e of toRetire) if (await isSettled(tx, "assignmentId", e.id)) settledRetire.add(e.id);
      const retiredNames = new Map<string, string>();
      for (const e of toRetire) {
        const s = byId.get(e.collaboratorId) ?? ((await tx.get(ref(C.collaborators, e.collaboratorId))).data() as CollaboratorDoc | undefined);
        retiredNames.set(e.id, s?.fullName ?? e.collaboratorId);
      }

      // ───── Validaciones ─────
      // Bloqueo por mes validado (D3)
      if (targetMonth?.status === "VALIDATED" && (!before || before.saleMonth !== saleMonth)) throw LOCKED(saleMonth);
      if (before) {
        const ratesChanged =
          existing.filter((e) => !e.removedAt).length !== data.assignments.length ||
          data.assignments.some((a) => {
            const prev = existing.find((x) => !x.removedAt && x.collaboratorId === a.collaboratorId);
            return !prev || !D(prev.baseRate).equals(D(a.ratePercent).div(100));
          });
        const economicsChanged =
          before.saleMonth !== saleMonth ||
          before.currency !== data.currency ||
          !D(before.saleAmount).equals(data.saleAmount) ||
          !D(before.providerCosts).equals(data.providerCosts) ||
          !D(before.saleReferenceRate).equals(refRate) ||
          ratesChanged;
        if (oldMonth?.status === "VALIDATED" && economicsChanged) throw LOCKED(before.saleMonth);

        const invoicedTotal = invoices.reduce((acc, i) => acc.plus(i.amountPreTax), D(0));
        if (D(data.saleAmount).lt(invoicedTotal)) {
          throw new DomainError("El valor de la venta no puede ser menor que el total ya facturado o previsto en facturas. Ajusta o anula primero las facturas.");
        }
        if (before.currency !== data.currency && invoices.length > 0) {
          throw new DomainError("No se puede cambiar la moneda de un proyecto que ya tiene facturas.");
        }
      }

      const rateChanging = existing.some((e) => {
        const next = incoming.get(e.collaboratorId);
        return !e.removedAt && (next === undefined || !D(e.baseRate).equals(next));
      });
      if (id && rateChanging && reason.length < 10) {
        throw new DomainError("Indica el motivo del cambio o retiro de porcentajes (mínimo 10 caracteres). Queda registrado en el historial.");
      }
      if (settledRetire.size > 0) throw new DomainError("No se puede retirar a un colaborador con comisiones ya liquidadas en este proyecto.");

      // ───── Asignaciones: diff contra las existentes. Nunca se borran (conservan historial); se retiran. ─────
      const t = now();
      const changes: string[] = [];
      const assignments: AssignmentDoc[] = existing.map((e) => ({ ...e, versions: [...e.versions] }));
      const version = (baseRate: string, why: string) => ({ baseRate, reason: why, createdAt: t, createdById: session.userId });

      for (const [collaboratorId, rate] of incoming) {
        const idx = assignments.findIndex((e) => e.collaboratorId === collaboratorId);
        const name = byId.get(collaboratorId)!.fullName;
        if (idx < 0) {
          assignments.push({
            id: newId(), collaboratorId, baseRate: rate.toFixed(), effectiveRate: null, effectiveRateRule: null, removedAt: null, removedReason: null,
            versions: [version(rate.toFixed(), id ? reason || "Asignación" : "Asignación inicial en la venta")], createdAt: t,
          });
          changes.push(`+ ${name} ${rate.mul(100).toFixed()} %`);
        } else {
          const prev = assignments[idx];
          if (prev.removedAt || !D(prev.baseRate).equals(rate)) {
            const caption = prev.removedAt ? "Reasignación" : "Cambio de porcentaje";
            changes.push(`~ ${name} ${pct(prev.baseRate)} % → ${rate.mul(100).toFixed()} %`);
            assignments[idx] = {
              ...prev, baseRate: rate.toFixed(), removedAt: null, removedReason: null, effectiveRate: null, effectiveRateRule: null,
              versions: [...prev.versions, version(rate.toFixed(), `${caption}: ${reason || "—"}`)],
            };
          }
        }
      }
      for (const e of toRetire) {
        const idx = assignments.findIndex((a) => a.id === e.id);
        assignments[idx] = { ...e, removedAt: t, removedReason: reason, versions: [...e.versions] };
        changes.push(`− ${retiredNames.get(e.id)} (${pct(e.baseRate)} %)`);
      }

      const doc: ProjectDoc = {
        id: projectId, code: data.code, name: data.name, client: data.client, country: data.country,
        saleDate: data.saleDate, saleMonth, currency: data.currency, saleAmount: D(data.saleAmount).toFixed(), providerCosts: D(data.providerCosts).toFixed(),
        netBase: netBase.toFixed(), saleReferenceRate: refRate.toFixed(), saleAmountCOP: saleAmountCOP.toFixed(), expectedInvoices: Number(data.expectedInvoices),
        notes: data.notes || null, assignments,
        collaboratorIds: assignments.filter((a) => !a.removedAt).map((a) => a.collaboratorId),
        everAssignedIds: Array.from(new Set(assignments.map((a) => a.collaboratorId))),
        voidedAt: null, voidedById: null, voidReason: null,
        createdAt: before?.createdAt ?? t, createdById: before?.createdById ?? session.userId, updatedAt: t, updatedById: session.userId,
      };

      // ───── Escrituras ─────
      tx.set(ref(C.projects, projectId), doc);
      audit(tx, {
        entity: "Project",
        entityId: projectId,
        action: id ? "UPDATE" : "CREATE",
        summary: `${id ? "Proyecto actualizado" : "Proyecto creado"}: ${doc.code}${changes.length ? ` · ${changes.join("; ")}` : ""}${reason && id ? ` · Motivo: ${reason}` : ""}`,
        before: before ? { ...before, assignments: undefined } : undefined,
        after: { ...doc, assignments: undefined },
        userId: session.userId,
      });
    });

    revalidateAll(projectId);
    return ok({ id: projectId }, id ? "Proyecto actualizado." : "Proyecto creado.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function voidProjectAction(input: { id: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const { id, reason } = voidSchema.parse(input);
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.projects, id));
      if (!snap.exists) throw new DomainError("El proyecto no existe.");
      const p = snap.data() as ProjectDoc;
      if (p.voidedAt) throw new DomainError("El proyecto ya está anulado.");
      const invoices = (await tx.get(col(C.invoices).where("projectId", "==", id))).docs.map((d) => d.data() as InvoiceDoc).filter((i) => !i.voidedAt);
      if (invoices.some((i) => i.status === "ISSUED" || i.collections.some((c) => !c.voidedAt))) {
        throw new DomainError("El proyecto tiene facturas emitidas o recaudos. Anúlalos primero (los que ya están liquidados no se pueden anular).");
      }
      const monthSnap = await tx.get(ref(C.monthlySales, p.saleMonth));
      if (monthSnap.exists && (monthSnap.data() as MonthlySalesDoc).status === "VALIDATED") throw LOCKED(p.saleMonth);

      const after: ProjectDoc = { ...p, voidedAt: now(), voidedById: session.userId, voidReason: reason, updatedAt: now(), updatedById: session.userId };
      tx.set(ref(C.projects, id), after);
      audit(tx, { entity: "Project", entityId: id, action: "VOID", summary: `Proyecto ${p.code} anulado. Motivo: ${reason}`, before: { ...p, assignments: undefined }, after: { ...after, assignments: undefined }, userId: session.userId });
    });
    revalidateAll(id);
    return ok(undefined, "Proyecto anulado.");
  } catch (e) {
    return toFailure(e);
  }
}
