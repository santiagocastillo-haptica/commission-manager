import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

import { isSetupOpen, setupAction } from "@/app/setup/actions";
import { authenticate } from "@/server/auth";
import { C, col, ref } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: "token-secreto", name: "Admin Prueba", email: "Admin@Haptica.co", password: "clave-muy-larga-123", ...over })) f.set(k, v);
  return f;
};

suite("configuración inicial (/setup)", () => {
  beforeEach(async () => {
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.SETUP_TOKEN = "token-secreto";
    await clearFirestore();
  });

  it("sin SETUP_TOKEN configurado la página está cerrada", async () => {
    delete process.env.SETUP_TOKEN;
    expect(await isSetupOpen()).toBe(false);
    expect((await setupAction({}, form())).error).toMatch(/no está disponible/);
  });

  it("rechaza token incorrecto, contraseñas cortas y limita los intentos", async () => {
    expect((await setupAction({}, form({ password: "corta" }))).error).toMatch(/12 caracteres/);
    for (let i = 0; i < 5; i++) expect((await setupAction({}, form({ token: "mal" }))).error).toMatch(/incorrecto/);
    // con el límite alcanzado, ni el token correcto pasa
    expect((await setupAction({}, form())).error).toMatch(/Demasiados intentos/);
    expect((await col(C.users).get()).size).toBe(0);
  });

  it("crea el administrador y las políticas, permite ingresar y se cierra para siempre", async () => {
    expect(await isSetupOpen()).toBe(true);
    expect(await setupAction({}, form())).toEqual({ done: true });
    expect((await col(C.users).get()).docs[0].data()).toMatchObject({ email: "admin@haptica.co", role: "ADMIN" });
    expect((await ref(C.policies, "GAMIFICATION").get()).exists).toBe(true);
    expect((await authenticate("admin@haptica.co", "clave-muy-larga-123")).ok).toBe(true);

    expect(await isSetupOpen()).toBe(false);
    expect((await setupAction({}, form({ email: "otro@haptica.co" }))).error).toMatch(/no está disponible/);
    expect((await col(C.users).get()).size).toBe(1);
  });
});
