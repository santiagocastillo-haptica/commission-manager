import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { emulatorHost, hasEmulator, projectId } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;

suite("reglas de seguridad: ningún cliente accede a Firestore", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, port] = (emulatorHost as string).split(":");
    env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) } });
    // El servidor (SDK Admin) sí puede escribir; aquí se simula con las reglas desactivadas.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "settlements/LIQ-2026-10"), { status: "APPROVED" });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("un visitante sin sesión no puede leer ni escribir", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "settlements/LIQ-2026-10")));
    await assertFails(setDoc(doc(anon, "settlements/LIQ-2026-10"), { status: "DRAFT" }));
  });

  it("ni siquiera un usuario autenticado de Firebase puede leer ni escribir", async () => {
    const user = env.authenticatedContext("alguien", { admin: true }).firestore();
    await assertFails(getDoc(doc(user, "users/x")));
    await assertFails(getDoc(doc(user, "settlements/LIQ-2026-10")));
    await assertFails(setDoc(doc(user, "commitments/x"), { a: 1 }));
    await assertFails(setDoc(doc(user, "auditLog/x"), { a: 1 }));
  });
});
