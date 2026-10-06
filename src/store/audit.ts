import { C, newId, ref } from "./collections";
import { jsonSafe, now, type Writer } from "./tx";
import type { AuditDoc } from "./types";

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "VOID" | "VALIDATE" | "REOPEN" | "CALCULATE" | "APPROVE" | "DISCARD" | "PAY" | "LOGIN" | (string & {});
  summary?: string;
  before?: unknown;
  after?: unknown;
  userId: string | null;
}

/**
 * Registra la bitácora en el MISMO lote/transacción que el cambio: no puede existir un cambio sin su registro.
 * La bitácora es de solo inserción: el código de la aplicación nunca actualiza ni elimina estos documentos.
 */
export function audit(w: Writer, entry: AuditEntry): string {
  const id = newId();
  const doc: AuditDoc = {
    id,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    summary: entry.summary ?? null,
    before: entry.before === undefined ? null : jsonSafe(entry.before),
    after: entry.after === undefined ? null : jsonSafe(entry.after),
    userId: entry.userId,
    createdAt: now(),
  };
  w.create(ref(C.auditLog, id), doc);
  return id;
}
