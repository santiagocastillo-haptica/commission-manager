import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ip: "203.0.113.60" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.cookies.has(k) ? { value: jar.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void jar.cookies.set(k, v),
    delete: (k: string) => void jar.cookies.delete(k),
  }),
  headers: async () => new Headers({ "x-forwarded-for": jar.ip }),
}));

import { getSession, requireSession, requireUser } from "@/server/auth";
import { loginWithGoogleEmail } from "@/server/google-login";
import { authorizedReport } from "@/server/report-http";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, ref } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const person = (id: string, email: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
  ref(C.collaborators, id).set({ id, fullName: `Persona ${id}`, email, position: "Analista", status, policyId: "GENERAL", joinDate: null, notes: null, createdAt: "x", updatedAt: "x" });

suite("acceso de un colaborador", () => {
  beforeEach(async () => {
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    jar.cookies.clear();
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  });

  it("un colaborador activo entra con su correo de Google y queda con rol de colaborador", async () => {
    await person("c1", "stiben.ibarra@haptica.co");
    expect(await loginWithGoogleEmail("Stiben.Ibarra@Haptica.co", "Stiben")).toEqual({ ok: true });
    const s = await getSession();
    expect(s).toMatchObject({ role: "COLLABORATOR", collaboratorId: "c1", email: "stiben.ibarra@haptica.co" });
    expect((await col(C.users).get()).docs.map((d) => d.data()).find((u) => u.email === "stiben.ibarra@haptica.co")).toMatchObject({ role: "COLLABORATOR", collaboratorId: "c1", passwordHash: "" });
    // volver a entrar no duplica el usuario
    await loginWithGoogleEmail("stiben.ibarra@haptica.co", "Stiben");
    expect((await col(C.users).where("email", "==", "stiben.ibarra@haptica.co").get()).size).toBe(1);
  });

  it("un correo que no es colaborador ni usuario, o un colaborador inactivo, no entra", async () => {
    await person("c2", "inactivo@haptica.co", "INACTIVE");
    expect((await loginWithGoogleEmail("inactivo@haptica.co", "X")).ok).toBe(false);
    expect((await loginWithGoogleEmail("otro@haptica.co", "X")).ok).toBe(false);
    expect(await getSession()).toBeNull();
  });

  it("si lo inactivan después, pierde el acceso aunque su sesión siga vigente", async () => {
    await person("c1", "stiben.ibarra@haptica.co");
    await loginWithGoogleEmail("stiben.ibarra@haptica.co", "Stiben");
    expect(await getSession()).not.toBeNull();
    await ref(C.collaborators, "c1").update({ status: "INACTIVE" });
    expect(await getSession()).toBeNull();
  });

  it("las páginas y acciones de administración rechazan a un colaborador; requireUser lo deja pasar", async () => {
    await person("c1", "stiben.ibarra@haptica.co");
    await loginWithGoogleEmail("stiben.ibarra@haptica.co", "Stiben");
    await expect(requireSession()).rejects.toThrow("REDIRECT:/mi-cuenta");
    expect((await requireUser()).role).toBe("COLLABORATOR");
  });

  it("un colaborador solo puede pedir su propio reporte; los reportes de todos son de administradores", async () => {
    await person("c1", "stiben.ibarra@haptica.co");
    await person("c2", "ana@haptica.co");
    await loginWithGoogleEmail("stiben.ibarra@haptica.co", "Stiben");
    const own = await authorizedReport("LIQ-2026-10", { collaboratorId: "c1" });
    expect("error" in own && own.error.status).not.toBe(403); // pasa el permiso (404: la liquidación no existe)
    const other = await authorizedReport("LIQ-2026-10", { collaboratorId: "c2" });
    expect("error" in other && other.error.status).toBe(403);
    const all = await authorizedReport("LIQ-2026-10");
    expect("error" in all && all.error.status).toBe(403);
  });
});
