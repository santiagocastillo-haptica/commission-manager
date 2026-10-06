import { DomainError } from "@/domain/project";

/** Errores de la capa de datos. Extienden DomainError para que las acciones los muestren como mensajes de formulario. */
export class StoreError extends DomainError {}

/** Ya existe un registro con esa clave única (correo, código, número de factura…). */
export class DuplicateError extends StoreError {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

/** Hay un cierre de liquidación por lotes en curso: las escrituras de negocio se rechazan hasta que termine. */
export class ClosingInProgressError extends StoreError {
  constructor(code: string) {
    super(`Hay un cierre de la liquidación ${code} en curso. Espera a que termine (o reanúdalo) antes de modificar datos.`);
  }
}

/** El registro ya fue liquidado y es inmutable. */
export class SettledError extends StoreError {}

export class NotFoundError extends StoreError {}

/** ¿El error de Firestore es «ya existe» (gRPC 6)? */
export function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: number | string })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}
