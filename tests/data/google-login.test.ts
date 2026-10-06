import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ip: "203.0.113.50" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.cookies.has(k) ? { value: jar.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void jar.cookies.set(k, v),
    delete: (k: string) => void jar.cookies.delete(k),
  }),
  headers: async () => new Headers({ "x-forwarded-for": jar.ip }),
}));

import bcrypt from "bcryptjs";
import { authenticate, getSession } from "@/server/auth";
import { loginWithGoogleEmail, loginWithGoogleIdToken } from "@/server/google-login";
import { C, col, encodeKey, ref } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const user = (id: string, email: string, passwordHash = "") => ref(C.users, id).set({ id, email, name: id, role: "ADMIN", passwordHash, createdAt: "x", updatedAt: "x" });

suite("ingreso con Google", () => {
  beforeEach(async () => {
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.BOOTSTRAP_ADMIN_EMAIL = "Dueno@Haptica.co";
    jar.cookies.clear();
    await clearFirestore();
  });

  it("un correo registrado entra (sin distinguir mayúsculas) y obtiene sesión", async () => {
    await user("u1", "ana@haptica.co");
    expect(await loginWithGoogleEmail("Ana@Haptica.co", "Ana")).toEqual({ ok: true });
    expect((await getSession())?.email).toBe("ana@haptica.co");
  });

  it("un correo no registrado se rechaza y cuenta como intento fallido", async () => {
    await user("u1", "ana@haptica.co");
    const r = await loginWithGoogleEmail("intruso@gmail.com", "X");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está registrado/);
    expect(jar.cookies.size).toBe(0);
    expect(((await ref(C.loginThrottle, encodeKey("ip:203.0.113.50")).get()).data() as { count: number }).count).toBe(1);
  });

  it("el correo del dueño se crea como administrador la primera vez, con políticas y meta, y no duplica", async () => {
    expect(await loginWithGoogleEmail("dueno@haptica.co", "Dueño")).toEqual({ ok: true });
    const users = (await col(C.users).get()).docs.map((d) => d.data());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "dueno@haptica.co", role: "ADMIN", name: "Dueño", passwordHash: "" });
    expect((await ref(C.policies, "GAMIFICATION").get()).exists).toBe(true);
    expect((await ref(C.goals, "2025-01-01").get()).exists).toBe(true);
    expect(await loginWithGoogleEmail("dueno@haptica.co", "Dueño")).toEqual({ ok: true });
    expect((await col(C.users).get()).size).toBe(1);
  });

  it("sin BOOTSTRAP_ADMIN_EMAIL nadie se crea solo", async () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    expect((await loginWithGoogleEmail("dueno@haptica.co", "D")).ok).toBe(false);
    expect((await col(C.users).get()).size).toBe(0);
  });

  it("un usuario creado solo con Google no puede entrar con contraseña vacía ni arbitraria", async () => {
    await user("u1", "ana@haptica.co", "");
    expect((await authenticate("ana@haptica.co", "")).ok).toBe(false);
    expect((await authenticate("ana@haptica.co", "cualquiera")).ok).toBe(false);
    // y un usuario con contraseña sigue entrando con ella
    await user("u2", "luis@haptica.co", await bcrypt.hash("clave-correcta-123", 4));
    expect((await authenticate("luis@haptica.co", "clave-correcta-123")).ok).toBe(true);
  });

  it("un token inválido se rechaza sin tocar los datos", async () => {
    const r = await loginWithGoogleIdToken("esto-no-es-un-token-de-google-1234567890");
    expect(r).toEqual({ ok: false, error: "No se pudo verificar tu cuenta de Google. Inténtalo de nuevo." });
    expect(jar.cookies.size).toBe(0);
  });
});
