import { beforeEach, describe, expect, it } from "vitest";
import { C, col, ref, type PolicyDoc, type UserDoc } from "@/store";
import { DEFAULT_TIERS, bootstrapBase, resetPassword } from "@/store/bootstrap";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const input = { email: "Admin@Haptica.co", name: "Admin", passwordHash: "hash-1" };

suite("bootstrap de Firestore", () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it("crea administrador, políticas con su escala y la meta inicial", async () => {
    const r = await bootstrapBase(input);
    expect(r).toEqual({ adminCreated: true, policiesCreated: ["GENERAL", "GAMIFICATION"], goalCreated: true });

    const users = await col(C.users).get();
    expect(users.size).toBe(1);
    expect(users.docs[0].data()).toMatchObject({ email: "admin@haptica.co", role: "ADMIN", passwordHash: "hash-1" });

    const gam = (await ref(C.policies, "GAMIFICATION").get()).data() as PolicyDoc;
    expect(gam.kind).toBe("GAMIFICATION_TIERS");
    expect(gam.tiers).toEqual(DEFAULT_TIERS);
    expect(((await ref(C.policies, "GENERAL").get()).data() as PolicyDoc).kind).toBe("GENERAL_THRESHOLD");

    const goals = await col(C.goals).get();
    expect(goals.docs[0].data()).toMatchObject({ amountCOP: "390000000", effectiveFrom: "2024-09-01" });
    expect((await col(C.auditLog).get()).size).toBe(1);
  });

  it("es idempotente: ejecutarlo de nuevo no cambia ni duplica nada", async () => {
    await bootstrapBase(input);
    const again = await bootstrapBase({ ...input, passwordHash: "otra-clave" });
    expect(again).toEqual({ adminCreated: false, policiesCreated: [], goalCreated: false });
    const users = await col(C.users).get();
    expect(users.size).toBe(1);
    expect((users.docs[0].data() as UserDoc).passwordHash).toBe("hash-1"); // no se sobrescribe
    expect((await col(C.goals).get()).size).toBe(1);
  });

  it("dos arranques simultáneos no crean dos administradores", async () => {
    await Promise.allSettled([bootstrapBase(input), bootstrapBase(input)]);
    expect((await col(C.users).get()).size).toBe(1);
  });

  it("restablece la contraseña solo si el usuario existe", async () => {
    expect(await resetPassword("nadie@haptica.co", "x")).toBe(false);
    await bootstrapBase(input);
    expect(await resetPassword("ADMIN@haptica.co", "hash-2")).toBe(true);
    const user = (await col(C.users).get()).docs[0].data() as UserDoc;
    expect(user.passwordHash).toBe("hash-2");
  });
});
