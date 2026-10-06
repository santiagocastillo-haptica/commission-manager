import "server-only";
import { getAuth } from "firebase-admin/auth";
import { C, adminApp, col } from "@/store";
import { bootstrapBase } from "@/store/bootstrap";
import { clientIp, isThrottled, recordFailure, startSession } from "./auth";
import type { UserDoc } from "@/store";

export type GoogleLoginResult = { ok: true } | { ok: false; error: string };

const NOT_REGISTERED = "Tu correo no está registrado en la aplicación. Pide al administrador que te dé acceso.";

/**
 * Inicia sesión con una cuenta de Google ya verificada. Solo entran los correos registrados como usuarios;
 * la única excepción es BOOTSTRAP_ADMIN_EMAIL (el dueño del sistema), que se crea como administrador al ingresar por primera vez.
 */
export async function loginWithGoogleEmail(emailRaw: string, name: string): Promise<GoogleLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const ipKey = `ip:${await clientIp()}`;
  if (await isThrottled(ipKey, 20)) return { ok: false, error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };

  const snap = await col(C.users).where("email", "==", email).limit(1).get();
  let user = snap.empty ? null : (snap.docs[0].data() as UserDoc);

  if (!user && email === (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase()) {
    // Sin contraseña: este usuario solo entra con Google.
    await bootstrapBase({ email, name: name || "Administrador", passwordHash: "" });
    const created = await col(C.users).where("email", "==", email).limit(1).get();
    user = created.empty ? null : (created.docs[0].data() as UserDoc);
  }
  if (!user) {
    await recordFailure(ipKey);
    return { ok: false, error: NOT_REGISTERED };
  }
  await startSession(user);
  return { ok: true };
}

/** Verifica el ID token de Firebase Authentication (emitido por Google) y entra si el correo está autorizado. */
export async function loginWithGoogleIdToken(idToken: string): Promise<GoogleLoginResult> {
  let decoded;
  try {
    decoded = await getAuth(adminApp()).verifyIdToken(idToken);
  } catch {
    return { ok: false, error: "No se pudo verificar tu cuenta de Google. Inténtalo de nuevo." };
  }
  if (!decoded.email || !decoded.email_verified || decoded.firebase?.sign_in_provider !== "google.com") {
    return { ok: false, error: "La cuenta de Google debe tener un correo verificado." };
  }
  return loginWithGoogleEmail(decoded.email, typeof decoded.name === "string" ? decoded.name : "");
}
