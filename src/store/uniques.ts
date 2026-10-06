import { C, encodeKey, ref } from "./collections";
import { DuplicateError } from "./errors";
import { now, type Tx, type Writer } from "./tx";
import type { UniqueDoc } from "./types";

export interface UniqueClaim {
  /** Clave única, p. ej. `email:ana@haptica.co` o `invoice:HAP-2026-001:FE-1001`. */
  key: string;
  /** Ruta del documento dueño de la clave (`collaborators/abc`). Permite re-guardar el mismo registro sin error. */
  owner: string;
  /** Mensaje para el usuario si ya existe. */
  message: string;
}

/**
 * Fase de LECTURA: verifica que las claves estén libres (o ya pertenezcan al mismo dueño) y devuelve la función que las
 * escribe. Se llama durante las lecturas de la transacción y se aplica con las demás escrituras
 * (Firestore exige todas las lecturas antes de la primera escritura).
 */
export async function prepareUniques(tx: Tx, claims: UniqueClaim[], releases: string[] = []): Promise<(w: Writer) => void> {
  const toCreate: { id: string; doc: UniqueDoc }[] = [];
  for (const c of claims) {
    const id = encodeKey(c.key);
    const snap = await tx.get(ref(C.uniques, id));
    if (snap.exists) {
      if ((snap.data() as UniqueDoc).ref !== c.owner) throw new DuplicateError(c.key, c.message);
      continue; // ya es suyo
    }
    toCreate.push({ id, doc: { id, key: c.key, ref: c.owner, createdAt: now() } });
  }
  return (w) => {
    for (const { id, doc } of toCreate) w.create(ref(C.uniques, id), doc);
    for (const key of releases) w.delete(ref(C.uniques, encodeKey(key)));
  };
}
