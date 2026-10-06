import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers se sustituye por un equivalente de prueba; los datos van al emulador de Firestore.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ip: "203.0.113.7" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.cookies.has(k) ? { value: jar.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void jar.cookies.set(k, v),
    delete: (k: string) => void jar.cookies.delete(k),
  }),
  headers: async () => new Headers({ "x-forwarded-for": `${jar.ip}, 10.0.0.1` }),
}));

import { authenticate, destroySession, getSession } from "@/server/auth";
import { C, col, encodeKey, ref, type LoginThrottleDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const throttle = async (key: string) => (await ref(C.loginThrottle, encodeKey(key)).get()).data() as LoginThrottleDoc | undefined;

suite("ingreso y límite de intentos (Firestore)", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
  });
  beforeEach(async () => {
    await clearFirestore();
    jar.cookies.clear();
    await ref(C.users, "u1").set({
      id: "u1", email: "throttle@haptica.local", name: "T", role: "ADMIN", passwordHash: await bcrypt.hash("clave-correcta-123", 4), createdAt: "x", updatedAt: "x",
    });
  });

  it("acepta credenciales correctas, crea la sesión y la reconoce; cerrar sesión la elimina", async () => {
    const r = await authenticate("Throttle@Haptica.local", "clave-correcta-123");
    expect(r.ok).toBe(true);
    expect(jar.cookies.get("hcm_session")).toBeTruthy();
    expect((await getSession())?.userId).toBe("u1");
    await destroySession();
    expect(await getSession()).toBeNull();
  });

  it("una sesión de un usuario que ya no existe no es válida", async () => {
    await authenticate("throttle@haptica.local", "clave-correcta-123");
    await ref(C.users, "u1").delete();
    expect(await getSession()).toBeNull();
  });

  it("tras 5 fallos bloquea el correo, incluso con la contraseña correcta", async () => {
    for (let i = 0; i < 5; i++) expect((await authenticate("throttle@haptica.local", "mala")).ok).toBe(false);
    const blocked = await authenticate("throttle@haptica.local", "clave-correcta-123");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/Demasiados intentos/);
  });

  it("el bloqueo persiste en Firestore (sirve con varias instancias)", async () => {
    for (let i = 0; i < 5; i++) await authenticate("throttle@haptica.local", "mala");
    expect((await throttle("email:throttle@haptica.local"))?.count).toBeGreaterThanOrEqual(5);
  });

  it("la ventana vencida reinicia el contador", async () => {
    for (let i = 0; i < 5; i++) await authenticate("throttle@haptica.local", "mala");
    for (const d of (await col(C.loginThrottle).get()).docs) await d.ref.update({ windowStart: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
    expect((await authenticate("throttle@haptica.local", "clave-correcta-123")).ok).toBe(true);
  });

  it("un correo inexistente cuenta intentos por IP sin revelar que no existe", async () => {
    const r = await authenticate("nadie@haptica.local", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Correo o contraseña incorrectos.");
    expect((await throttle("ip:203.0.113.7"))?.count).toBeGreaterThan(0);
  });

  it("un ingreso exitoso borra el contador del correo", async () => {
    await authenticate("throttle@haptica.local", "mala");
    await authenticate("throttle@haptica.local", "clave-correcta-123");
    expect(await throttle("email:throttle@haptica.local")).toBeUndefined();
  });
});
