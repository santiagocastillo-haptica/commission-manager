import { ZodError } from "zod";
import { DomainError } from "@/domain/project";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T = undefined>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Traduce errores de validación o de dominio a un resultado entendible para el formulario. */
export function toFailure(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) {
      const path = issue.path.join(".");
      if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
    }
    return fail("Revisa los campos marcados.", fieldErrors);
  }
  if (e instanceof DomainError) return fail(e.message);
  const code = (e as { code?: string })?.code;
  if (code === "P2002") return fail("Ya existe un registro con ese valor único (código, número o correo).");
  if (code === "23514") return fail("La operación viola una regla de integridad de los datos.");
  console.error(e);
  return fail("Ocurrió un error inesperado. Intenta de nuevo.");
}
