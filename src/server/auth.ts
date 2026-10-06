import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession, type SessionPayload } from "@/lib/session";
import { C, col, encodeKey, ref, runTx, now, type LoginThrottleDoc, type UserDoc } from "@/store";

async function readCookieSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Sesión vigente: cookie válida Y usuario existente. La cookie podría referirse a un usuario que ya no existe
 * (p. ej. tras recargar los datos); en ese caso no hay sesión.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const session = await readCookieSession();
  if (!session) return null;
  const exists = (await ref(C.users, session.userId).get()).exists;
  return exists ? session : null;
}

/** Úsese al inicio de cada página y de cada Server Action: las acciones son alcanzables por POST directo. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// Límite de intentos fallidos guardado en Firestore (funciona con varias instancias): 5 por correo y 20 por IP cada 15 minutos.
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { email: 5, ip: 20 } as const;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "desconocida").trim();
}

const throttleRef = (key: string) => ref(C.loginThrottle, encodeKey(key));

export async function isThrottled(key: string, limit: number): Promise<boolean> {
  const snap = await throttleRef(key).get();
  if (!snap.exists) return false;
  const row = snap.data() as LoginThrottleDoc;
  return Date.now() - new Date(row.windowStart).getTime() < WINDOW_MS && row.count >= limit;
}

export async function recordFailure(key: string) {
  await runTx(async (tx) => {
    const r = throttleRef(key);
    const snap = await tx.get(r);
    const row = snap.exists ? (snap.data() as LoginThrottleDoc) : null;
    if (!row || Date.now() - new Date(row.windowStart).getTime() >= WINDOW_MS) {
      tx.set(r, { id: encodeKey(key), key, count: 1, windowStart: now() } satisfies LoginThrottleDoc);
    } else {
      tx.update(r, { count: row.count + 1 });
    }
  });
}

export async function authenticate(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = email.trim().toLowerCase();
  const emailKey = `email:${mail}`;
  const ipKey = `ip:${await clientIp()}`;
  if ((await isThrottled(emailKey, LIMITS.email)) || (await isThrottled(ipKey, LIMITS.ip))) {
    return { ok: false, error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };
  }

  const snap = await col(C.users).where("email", "==", mail).limit(1).get();
  const user = snap.empty ? null : (snap.docs[0].data() as UserDoc);
  // Se compara siempre contra un hash para no revelar si el correo existe.
  const hash = user?.passwordHash || "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv"; // usuarios solo-Google no tienen contraseña
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    await Promise.all([recordFailure(emailKey), recordFailure(ipKey)]);
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  await throttleRef(emailKey).delete();
  await startSession(user);
  return { ok: true };
}

/** Crea la cookie de sesión (JWT httpOnly) de un usuario ya verificado. */
export async function startSession(user: Pick<UserDoc, "id" | "email" | "name" | "role">) {
  const token = await signSession({ userId: user.id, email: user.email, name: user.name, role: user.role });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
