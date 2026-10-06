"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, destroySession } from "@/server/auth";
import { loginWithGoogleIdToken } from "@/server/google-login";

const loginSchema = z.object({
  email: z.string().trim().email("Ingresa un correo válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error };

  const next = String(formData.get("next") ?? "");
  // Solo rutas internas, para evitar redirecciones abiertas.
  redirect(/^\/(?![\/\\])[^\\\r\n]*$/.test(next) ? next : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export interface GoogleLoginState {
  error?: string;
  next?: string;
}

/** Recibe el ID token que entrega Firebase Authentication tras el ingreso con Google en el navegador. */
export async function googleLoginAction(idToken: string, next: string): Promise<GoogleLoginState> {
  if (typeof idToken !== "string" || idToken.length < 20) return { error: "No se pudo verificar tu cuenta de Google." };
  const result = await loginWithGoogleIdToken(idToken);
  if (!result.ok) return { error: result.error };
  // Solo rutas internas, para evitar redirecciones abiertas.
  return { next: /^\/(?![\/\\])[^\\\r\n]*$/.test(next) ? next : "/" };
}
