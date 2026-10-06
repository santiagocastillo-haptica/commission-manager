import type { DocumentData, DocumentReference, SetOptions, Transaction, UpdateData } from "firebase-admin/firestore";
import { db } from "./admin";

export type Tx = Transaction;

/** Operaciones de escritura comunes a una transacción y a un lote (WriteBatch). */
export interface Writer {
  create(ref: DocumentReference, data: DocumentData): unknown;
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): unknown;
  update(ref: DocumentReference, data: UpdateData<DocumentData>): unknown;
  delete(ref: DocumentReference): unknown;
}

/** Instante actual como texto ISO-8601 (UTC). */
export const now = (): string => new Date().toISOString();

/**
 * Ejecuta una transacción. Recuerda: en Firestore TODAS las lecturas van antes que cualquier escritura.
 * Firestore reintenta solo por contención; los errores de negocio (DomainError) se propagan tal cual.
 */
export function runTx<T>(fn: (tx: Tx) => Promise<T>, maxAttempts = 5): Promise<T> {
  return db().runTransaction(fn, { maxAttempts });
}

/**
 * Límites vigentes de Firestore (documentación de cuotas): solicitud de hasta 10 MiB y transacción de hasta 270 s
 * (ya no existe el tope de 500 escrituras). Se deja margen: si el cierre de una liquidación estimara más de
 * MAX_TX_BYTES, se usa el protocolo por lotes reanudable en lugar de una sola transacción.
 */
export const MAX_TX_BYTES = 8 * 1024 * 1024;
export const BATCH_SIZE = 400;

/** Tamaño aproximado (bytes) de un conjunto de documentos, para decidir entre transacción única o cierre por lotes. */
export function estimateBytes(docs: unknown[]): number {
  return docs.reduce<number>((acc, d) => acc + Buffer.byteLength(JSON.stringify(d ?? null), "utf8") + 64, 0);
}

/** ¿Cabe el cierre en una sola transacción? */
export const fitsInOneTx = (docs: unknown[]): boolean => estimateBytes(docs) <= MAX_TX_BYTES;

/**
 * Aplica operaciones en lotes de ≤ BATCH_SIZE escrituras. NO es atómico entre lotes: úsalo solo con operaciones
 * idempotentes (IDs deterministas con create/set) dentro de un protocolo que se pueda reanudar.
 */
export async function commitInBatches(ops: ((w: Writer) => void)[], size = BATCH_SIZE): Promise<number> {
  let committed = 0;
  for (let i = 0; i < ops.length; i += size) {
    const batch = db().batch();
    for (const op of ops.slice(i, i + size)) op(batch as unknown as Writer);
    await batch.commit();
    committed += Math.min(size, ops.length - i);
  }
  return committed;
}

/** Copia JSON segura para Firestore/auditoría: sin `undefined`, con fechas y decimales como texto. */
export function jsonSafe<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}
