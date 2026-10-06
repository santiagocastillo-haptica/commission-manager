import { C, col, systemStateRef } from "./collections";
import { ClosingInProgressError, SettledError } from "./errors";
import type { Tx } from "./tx";
import type { CommitmentDoc, SystemStateDoc } from "./types";

/** ID determinista de la clave anti pago doble y de la línea de liquidación: `${recaudo|ajuste}__${asignación}`. */
export const commitKey = (targetId: string, assignmentId: string): string => `${targetId}__${assignmentId}`;

// ───────────── Bloqueo de cierre por lotes ─────────────

/** LECTURA. Cierre por lotes en curso (si lo hay). */
export async function readClosing(tx: Tx): Promise<SystemStateDoc["closing"]> {
  const snap = await tx.get(systemStateRef());
  return snap.exists ? ((snap.data() as SystemStateDoc).closing ?? null) : null;
}

/** LECTURA. Toda acción que modifica datos de negocio debe llamarlo: mientras haya un cierre en curso se rechaza. */
export async function assertNotClosing(tx: Tx): Promise<void> {
  const closing = await readClosing(tx);
  if (closing) throw new ClosingInProgressError(closing.settlementCode);
}

// ───────────── Registros ya liquidados ─────────────

export type CommitmentField = "collectionId" | "adjustmentId" | "invoiceId" | "assignmentId" | "projectId";

/** LECTURA. Compromisos (líneas liquidadas) asociados a un registro. */
export async function listCommitments(tx: Tx, field: CommitmentField, value: string, limit = 50): Promise<CommitmentDoc[]> {
  const snap = await tx.get(col(C.commitments).where(field, "==", value).limit(limit));
  return snap.docs.map((d) => d.data() as CommitmentDoc);
}

/** LECTURA. ¿Tiene el registro comisiones ya liquidadas? */
export async function isSettled(tx: Tx, field: CommitmentField, value: string): Promise<boolean> {
  return (await listCommitments(tx, field, value, 1)).length > 0;
}

/** LECTURA. Falla con SettledError si el registro ya fue liquidado. */
export async function assertNotSettled(tx: Tx, field: CommitmentField, value: string, message: string): Promise<void> {
  if (await isSettled(tx, field, value)) throw new SettledError(message);
}
