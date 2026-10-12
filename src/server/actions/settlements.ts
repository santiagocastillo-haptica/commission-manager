"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayBogota } from "@/domain/dates";
import { settlementPeriod } from "@/domain/periods";
import { dateString, positiveMoney } from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import { C, assertNotClosing, audit, isSettled, newId, now, ref, runTx, type CollaboratorDoc, type MonthlySalesDoc, type PolicyDoc, type ProjectDoc, type SettlementReviewDoc } from "@/store";
import { effectiveRate, evaluateMonth } from "@/domain/policies";
import { D, formatPercent } from "@/domain/money";
import { DomainError } from "@/domain/project";
import { requireSession } from "../auth";
import { getSettlementView, parseSettlementCode } from "../queries/settlements";
import { approveSettlement, calculateDraft, discardDraft, finishClosing, registerPayment } from "../services/settlements";

const periodSchema = z.object({ year: z.number().int().min(2020).max(2100), half: z.enum(["APRIL", "OCTOBER"]) });

function revalidateSettlements(code?: string) {
  revalidatePath("/liquidaciones");
  if (code) revalidatePath(`/liquidaciones/${code}`);
  revalidatePath("/");
  revalidatePath("/colaboradores");
  revalidatePath("/proyectos");
}

const codeOf = (year: number, half: "APRIL" | "OCTOBER") => `LIQ-${year}-${half === "APRIL" ? "04" : "10"}`;

export async function calculateSettlementAction(input: z.input<typeof periodSchema>): Promise<ActionResult<{ lines: number }>> {
  const session = await requireSession();
  try {
    const { year, half } = periodSchema.parse(input);
    if (settlementPeriod(year, half).periodStart > todayBogota()) {
      return { ok: false, error: "Ese período aún no ha comenzado: no tiene recaudos para liquidar." };
    }
    const res = await runTx(async (tx) => {
      await assertNotClosing(tx);
      return calculateDraft(tx, year, half, session.userId);
    });
    revalidateSettlements(codeOf(year, half));
    return ok({ lines: res.result.lines.length }, `Liquidación calculada: ${res.result.lines.length} líneas.`);
  } catch (e) {
    return toFailure(e);
  }
}

export async function approveSettlementAction(input: { settlementId: string; acknowledged: string[]; code: string; expectedGross: string; expectedNet: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = z.object({ settlementId: z.string().min(1), acknowledged: z.array(z.string()), code: z.string(), expectedGross: z.string(), expectedNet: z.string() }).parse(input);
    await approveSettlement(data.settlementId, session.userId, data.acknowledged, { gross: data.expectedGross, net: data.expectedNet });
    revalidateSettlements(data.code);
    return ok(undefined, "Liquidación aprobada y cerrada. Ya puedes descargar los reportes y registrar los pagos.");
  } catch (e) {
    return toFailure(e);
  }
}

/** Reanuda un cierre por lotes interrumpido (no duplica ni pierde nada). */
export async function resumeClosingAction(input: { code: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    await finishClosing(z.string().min(1).parse(input.code), session.userId);
    revalidateSettlements(input.code);
    return ok(undefined, "Cierre completado.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function discardDraftAction(input: { settlementId: string; code: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      await discardDraft(tx, input.settlementId, session.userId);
    });
    revalidateSettlements(input.code);
    return ok(undefined, "Borrador reiniciado.");
  } catch (e) {
    return toFailure(e);
  }
}

const paymentSchema = z.object({
  collaboratorSettlementId: z.string().min(1),
  code: z.string(),
  paidAt: dateString,
  amount: positiveMoney,
  reference: z.string({ error: "La referencia es obligatoria." }).trim().min(3, "Indica la referencia de pago (mínimo 3 caracteres).").max(120),
  notes: z.string().trim().max(1000).optional(),
});

export async function registerPaymentAction(input: z.input<typeof paymentSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = paymentSchema.parse(input);
    if (data.paidAt > todayBogota()) return { ok: false, error: "La fecha de pago no puede ser futura.", fieldErrors: { paidAt: "La fecha de pago no puede ser futura." } };
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      await registerPayment(tx, data.collaboratorSettlementId, { paidAt: data.paidAt, amount: data.amount, reference: data.reference, notes: data.notes }, session.userId);
    });
    revalidateSettlements(data.code);
    return ok(undefined, "Pago registrado.");
  } catch (e) {
    return toFailure(e);
  }
}


const reviewSchema = z.object({ code: z.string().min(1), projectCode: z.string().min(1), accepted: z.boolean() });

/**
 * Acepta (o quita la aceptación de) un proyecto dentro de una liquidación en borrador: «lo revisé y está bien».
 * Se guarda con la huella de las líneas actuales; si después cambian, la aceptación deja de valer y hay que revisarlo de nuevo.
 */
export async function setProjectReviewAction(input: z.input<typeof reviewSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = reviewSchema.parse(input);
    const parsed = parseSettlementCode(data.code);
    if (!parsed) return { ok: false, error: "Liquidación no válida." };
    const view = await getSettlementView(parsed.year, parsed.half);
    if (view.status === "APPROVED" || view.status === "CLOSING") return { ok: false, error: "La liquidación ya está aprobada: la revisión quedó registrada y no se modifica." };
    const project = view.projects.find((p) => p.projectCode === data.projectCode);
    if (!project) return { ok: false, error: "Ese proyecto no tiene líneas en esta liquidación (recalcula)." };

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const r = ref(C.settlementReviews, data.code);
      const snap = await tx.get(r);
      const doc: SettlementReviewDoc = snap.exists ? (snap.data() as SettlementReviewDoc) : { id: data.code, code: data.code, projects: {}, updatedAt: now() };
      const projects = { ...doc.projects };
      if (data.accepted) projects[data.projectCode] = { fingerprint: project.fingerprint, acceptedAt: now(), acceptedById: session.userId };
      else delete projects[data.projectCode];
      tx.set(r, { ...doc, projects, updatedAt: now() });
      audit(tx, {
        entity: "SettlementReview", entityId: data.code, action: data.accepted ? "ACCEPT" : "UNACCEPT", userId: session.userId,
        summary: `Proyecto ${data.projectCode} ${data.accepted ? "aceptado" : "desmarcado"} en la revisión de ${data.code} (${project.lines.length} línea(s), comisión ${project.total})`,
      });
    });
    revalidatePath(`/liquidaciones/${data.code}`);
    return ok(undefined, data.accepted ? "Proyecto aceptado." : "Aceptación retirada.");
  } catch (e) {
    return toFailure(e);
  }
}

const exceptionSchema = z.object({
  projectCode: z.string().min(1),
  assignmentId: z.string().min(1),
  /** Porcentaje efectivo en puntos porcentuales (0.5 = 0,5 %); null quita la excepción y restaura el porcentaje calculado. */
  ratePercent: z.string().trim().regex(/^\d+(\.\d+)?$/, "Ingresa un porcentaje válido (ej. 0.5).").nullable(),
  reason: z.string().trim().max(1000),
  /** BONUS: bonificación (se rotula así en la liquidación); por defecto, excepción manual. */
  kind: z.enum(["MANUAL", "BONUS"]).optional(),
});

/**
 * Excepción manual del porcentaje efectivo de una persona en un proyecto (sin tope). Aplica a todos sus recaudos aún no
 * liquidados. Requiere el mes de venta validado y que la asignación no tenga comisiones ya liquidadas; motivo obligatorio.
 */
export async function setRateExceptionAction(input: z.input<typeof exceptionSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = exceptionSchema.parse(input);
    const bonus = data.kind === "BONUS";
    if (data.ratePercent !== null && data.reason.length < 10) {
      return { ok: false, error: "Explica el motivo de la excepción (mínimo 10 caracteres).", fieldErrors: { reason: "Explica el motivo (mínimo 10 caracteres)." } };
    }
    if (data.ratePercent !== null && D(data.ratePercent).gt(100)) return { ok: false, error: "El porcentaje no puede superar 100 %.", fieldErrors: { ratePercent: "Máximo 100 %." } };

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.projects, data.projectCode));
      if (!snap.exists) throw new DomainError("El proyecto no existe.");
      const project = snap.data() as ProjectDoc;
      if (project.voidedAt) throw new DomainError("El proyecto está anulado.");
      const idx = project.assignments.findIndex((a) => a.id === data.assignmentId && !a.removedAt);
      if (idx < 0) throw new DomainError("La asignación no existe o ya fue retirada.");
      const month = await tx.get(ref(C.monthlySales, project.saleMonth));
      if (!month.exists || (month.data() as MonthlySalesDoc).status !== "VALIDATED") {
        throw new DomainError("Valida primero el mes de venta del proyecto: la excepción modifica el porcentaje que se fija al validarlo.");
      }
      if (await isSettled(tx, "assignmentId", data.assignmentId)) {
        throw new DomainError("Esta asignación ya tiene comisiones liquidadas: su porcentaje no se puede modificar. Registra un ajuste.");
      }

      const a = project.assignments[idx];
      const t = now();
      let next = a;
      let summary: string;
      if (data.ratePercent === null) {
        if (!a.exception) throw new DomainError("Esa asignación no tiene una excepción de porcentaje.");
        next = { ...a, effectiveRate: a.exception.previousRate, effectiveRateRule: a.exception.previousRule, exception: null };
        summary = `Excepción de porcentaje retirada en ${project.code}: vuelve a ${a.exception.previousRate ? formatPercent(a.exception.previousRate) : "—"}`;
      } else {
        const rate = D(data.ratePercent).div(100);
        const previous = a.exception ?? { previousRate: a.effectiveRate, previousRule: a.effectiveRateRule };
        next = {
          ...a,
          effectiveRate: rate.toFixed(),
          effectiveRateRule: `${bonus ? "Bonificación" : "Excepción manual"}: ${data.reason}`,
          exception: { ...(bonus ? { kind: "BONUS" as const } : {}), reason: data.reason, at: t, byId: session.userId, previousRate: previous.previousRate, previousRule: previous.previousRule },
        };
        summary = `${bonus ? "Bonificación" : "Excepción de porcentaje"} en ${project.code}: ${a.effectiveRate ? formatPercent(a.effectiveRate) : "—"} → ${formatPercent(rate)}. Motivo: ${data.reason}`;
      }
      const assignments = project.assignments.map((x, i) => (i === idx ? next : x));
      tx.set(ref(C.projects, project.id), { ...project, assignments, updatedAt: t, updatedById: session.userId });
      audit(tx, { entity: "Project", entityId: project.id, action: "RATE_EXCEPTION", summary, before: { effectiveRate: a.effectiveRate }, after: { effectiveRate: next.effectiveRate }, userId: session.userId });
    });
    for (const p of ["/liquidaciones", "/proyectos", "/colaboradores", "/"]) revalidatePath(p);
    revalidatePath(`/proyectos/${data.projectCode}`);
    return ok(undefined, data.ratePercent === null ? (bonus ? "Bonificación retirada." : "Excepción retirada.") : bonus ? "Bonificación guardada." : "Excepción guardada. Recalcula la liquidación para verla reflejada.");
  } catch (e) {
    return toFailure(e);
  }
}

const addPersonSchema = z.object({
  projectCode: z.string().min(1),
  collaboratorId: z.string().min(1),
  /** Porcentaje base en puntos porcentuales (1 = 1 %). */
  ratePercent: z.string().trim().regex(/^\d+(\.\d+)?$/, "Ingresa un porcentaje válido (ej. 1)."),
  reason: z.string().trim().min(10, "Explica el motivo (mínimo 10 caracteres).").max(1000),
});

/**
 * Suma a otra persona a un proyecto desde la liquidación. No toca la venta ni la meta del mes, así que funciona aunque el
 * mes esté validado: el porcentaje efectivo se fija de inmediato con el resultado ya guardado del mes.
 */
export async function addProjectPersonAction(input: z.input<typeof addPersonSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = addPersonSchema.parse(input);
    const base = D(data.ratePercent).div(100);
    if (base.lte(0) || base.gt(1)) throw new DomainError("El porcentaje base debe ser mayor que 0 y no superar 100 %.");

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.projects, data.projectCode));
      if (!snap.exists) throw new DomainError("El proyecto no existe.");
      const project = snap.data() as ProjectDoc;
      if (project.voidedAt) throw new DomainError("El proyecto está anulado.");
      const personSnap = await tx.get(ref(C.collaborators, data.collaboratorId));
      if (!personSnap.exists) throw new DomainError("El colaborador no existe.");
      const person = personSnap.data() as CollaboratorDoc;
      if (person.status !== "ACTIVE") throw new DomainError(`${person.fullName} está inactivo.`);
      if (person.policyId === "GAMIFICATION" && !base.equals(0.01)) {
        throw new DomainError(`Para ${person.fullName} (política de gamificación) el porcentaje base debe ser 1 %. La escala de cumplimiento se aplica sobre ese valor.`);
      }
      if (project.assignments.some((a) => a.collaboratorId === data.collaboratorId && !a.removedAt)) throw new DomainError(`${person.fullName} ya comisiona en este proyecto.`);

      const monthSnap = await tx.get(ref(C.monthlySales, project.saleMonth));
      const month = monthSnap.exists ? (monthSnap.data() as MonthlySalesDoc) : null;
      const policySnap = await tx.get(ref(C.policies, person.policyId));
      let effective: string | null = null;
      let rule: string | null = null;
      if (month?.status === "VALIDATED" && month.validatedSalesCOP !== null && month.goalSnapshotCOP !== null) {
        if (!policySnap.exists) throw new DomainError("No se encontró la política del colaborador.");
        const policy = policySnap.data() as PolicyDoc;
        const tiers = policy.tiers.map((x) => ({ min: x.min, factor: x.factor, effectiveFrom: x.effectiveFrom }));
        const er = effectiveRate(policy.kind, base, evaluateMonth(project.saleMonth, month.validatedSalesCOP, month.goalSnapshotCOP), tiers);
        effective = er.rate.toFixed();
        rule = er.rule;
      }

      const t = now();
      const idx = project.assignments.findIndex((a) => a.collaboratorId === data.collaboratorId);
      const version = { baseRate: base.toFixed(), reason: `Se suma desde la liquidación: ${data.reason}`, createdAt: t, createdById: session.userId };
      const assignments = [...project.assignments];
      if (idx >= 0) {
        assignments[idx] = { ...assignments[idx], baseRate: base.toFixed(), removedAt: null, removedReason: null, effectiveRate: effective, effectiveRateRule: rule, exception: null, versions: [...assignments[idx].versions, version] };
      } else {
        assignments.push({ id: newId(), collaboratorId: data.collaboratorId, baseRate: base.toFixed(), effectiveRate: effective, effectiveRateRule: rule, removedAt: null, removedReason: null, versions: [version], createdAt: t });
      }
      tx.set(ref(C.projects, project.id), {
        ...project,
        assignments,
        collaboratorIds: assignments.filter((a) => !a.removedAt).map((a) => a.collaboratorId),
        everAssignedIds: Array.from(new Set(assignments.map((a) => a.collaboratorId))),
        updatedAt: t,
        updatedById: session.userId,
      });
      audit(tx, { entity: "Project", entityId: project.id, action: "ADD_PERSON", summary: `Se suma a ${person.fullName} (${formatPercent(base)}) en ${project.code}. Motivo: ${data.reason}`, userId: session.userId });
    });
    for (const p of ["/liquidaciones", "/proyectos", "/colaboradores", "/"]) revalidatePath(p);
    revalidatePath(`/proyectos/${data.projectCode}`);
    return ok(undefined, "Persona agregada. Recalcula la liquidación para ver su comisión.");
  } catch (e) {
    return toFailure(e);
  }
}
