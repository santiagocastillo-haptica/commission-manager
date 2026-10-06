"use server";

import { revalidatePath } from "next/cache";
import { DomainError } from "@/domain/project";
import { collaboratorSchema, type CollaboratorInput } from "@/lib/schemas";
import { fail, ok, toFailure, type ActionResult } from "@/server/action-result";
import { C, assertNotClosing, audit, col, newId, now, prepareUniques, ref, runTx, type CollaboratorDoc, type PolicyDoc } from "@/store";
import { requireSession } from "../auth";

class PolicyLockedError extends DomainError {}

export async function saveCollaboratorAction(id: string | null, input: CollaboratorInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  try {
    const data = collaboratorSchema.parse(input);
    const docId = id ?? newId();

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const policy = await tx.get(ref(C.policies, data.policyId));
      if (!policy.exists) throw new DomainError("La política de comisiones seleccionada no existe.");
      const code = (policy.data() as PolicyDoc).code;

      const snap = await tx.get(ref(C.collaborators, docId));
      const before = snap.exists ? (snap.data() as CollaboratorDoc) : null;
      if (id && !before) throw new DomainError("El colaborador no existe.");

      // Cambiar la política cuando ya hay proyectos asignados altera cómo se calcula el porcentaje efectivo.
      if (before && before.policyId !== code) {
        const used = await tx.get(col(C.projects).where("everAssignedIds", "array-contains", docId).limit(1));
        if (!used.empty) {
          throw new PolicyLockedError("policy-locked");
        }
      }

      const applyUniques = await prepareUniques(
        tx,
        [{ key: `email:${data.email}`, owner: `${C.collaborators}/${docId}`, message: "Ya existe un colaborador con ese correo." }],
        before && before.email !== data.email ? [`email:${before.email}`] : [],
      );

      const t = now();
      const after: CollaboratorDoc = {
        id: docId,
        fullName: data.fullName,
        email: data.email,
        position: data.position,
        status: data.status,
        policyId: code,
        joinDate: data.joinDate || null,
        notes: data.notes || null,
        createdAt: before?.createdAt ?? t,
        createdById: before?.createdById ?? session.userId,
        updatedAt: t,
        updatedById: session.userId,
      };
      applyUniques(tx);
      tx.set(ref(C.collaborators, docId), after);
      audit(tx, { entity: "Collaborator", entityId: docId, action: before ? "UPDATE" : "CREATE", summary: `Colaborador ${after.fullName} ${before ? "actualizado" : "creado"}`, before: before ?? undefined, after, userId: session.userId });
    });

    revalidatePath("/colaboradores");
    revalidatePath(`/colaboradores/${docId}`);
    return ok({ id: docId }, id ? "Colaborador actualizado." : "Colaborador creado.");
  } catch (e) {
    if (e instanceof PolicyLockedError)
      return fail("No se puede cambiar la política de comisiones de un colaborador que ya tiene proyectos asignados: alteraría el cálculo de sus porcentajes efectivos.", { policyId: "Bloqueado: el colaborador ya tiene proyectos asignados." });
    return toFailure(e);
  }
}
