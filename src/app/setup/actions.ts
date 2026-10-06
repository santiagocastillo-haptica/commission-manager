"use server";

import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { clientIp, isThrottled, recordFailure } from "@/server/auth";
import { C, col } from "@/store";
import { bootstrapBase } from "@/store/bootstrap";

export interface SetupState {
  error?: string;
  done?: boolean;
}

const schema = z.object({
  token: z.string().min(1, "Ingresa el token de configuración."),
  name: z.string().trim().min(2, "Ingresa el nombre del administrador."),
  email: z.string().trim().email("Ingresa un correo válido."),
  password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres."),
});

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** ¿Ya existe algún usuario? Con uno solo, la configuración inicial queda cerrada para siempre. */
export async function isSetupOpen(): Promise<boolean> {
  if (!process.env.SETUP_TOKEN) return false;
  return (await col(C.users).limit(1).get()).empty;
}

/**
 * Configuración inicial de un entorno nuevo (crea el administrador, las políticas y la meta). Doble candado:
 *  1. exige el token secreto SETUP_TOKEN (Secret Manager), comparado en tiempo constante y con límite de intentos;
 *  2. se cierra sola en cuanto existe cualquier usuario, aunque el token se filtre después.
 */
export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const parsed = schema.safeParse({ token: formData.get("token"), name: formData.get("name"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (!(await isSetupOpen())) return { error: "La configuración inicial no está disponible." };

  const key = `setup:${await clientIp()}`;
  if (await isThrottled(key, 5)) return { error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };
  if (!same(parsed.data.token, process.env.SETUP_TOKEN!)) {
    await recordFailure(key);
    return { error: "Token de configuración incorrecto." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await bootstrapBase({ email: parsed.data.email, name: parsed.data.name, passwordHash });
  return { done: true };
}
