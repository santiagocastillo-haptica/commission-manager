import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  ClosingInProgressError,
  DuplicateError,
  SettledError,
  assertNotClosing,
  assertNotSettled,
  audit,
  col,
  commitInBatches,
  commitKey,
  db,
  fitsInOneTx,
  isAlreadyExists,
  isSettled,
  jsonSafe,
  newId,
  prepareUniques,
  ref,
  runTx,
  systemStateRef,
  type CommitmentDoc,
} from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;

const commitment = (collectionId: string, assignmentId: string): CommitmentDoc => ({
  id: commitKey(collectionId, assignmentId),
  type: "COLLECTION",
  collectionId,
  adjustmentId: null,
  assignmentId,
  invoiceId: "inv1",
  projectId: "HAP-1",
  collaboratorId: "c1",
  settlementCode: "LIQ-2026-10",
  lineId: commitKey(collectionId, assignmentId),
  commissionCOP: "1000000",
  committedAt: new Date().toISOString(),
});

suite("capa de datos de Firestore (emulador)", () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  describe("unicidad", () => {
    const claim = (owner: string) =>
      runTx(async (tx) => {
        const apply = await prepareUniques(tx, [{ key: "email:ana@haptica.co", owner, message: "El correo ya está registrado." }]);
        apply(tx);
      });

    it("rechaza una clave ya tomada por otro registro", async () => {
      await claim("collaborators/a");
      await expect(claim("collaborators/b")).rejects.toThrow(DuplicateError);
      await expect(claim("collaborators/b")).rejects.toThrow(/ya está registrado/);
    });

    it("permite que el mismo dueño vuelva a guardar su propia clave", async () => {
      await claim("collaborators/a");
      await expect(claim("collaborators/a")).resolves.toBeUndefined();
    });

    it("de dos reclamos simultáneos solo uno gana", async () => {
      const results = await Promise.allSettled([claim("collaborators/a"), claim("collaborators/b")]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(DuplicateError);
    });

    it("liberar una clave permite reutilizarla (p. ej. al cambiar un correo)", async () => {
      await claim("collaborators/a");
      await runTx(async (tx) => {
        const apply = await prepareUniques(tx, [], ["email:ana@haptica.co"]);
        apply(tx);
      });
      await expect(claim("collaborators/b")).resolves.toBeUndefined();
    });

    it("las claves con caracteres especiales (/, :, espacios) se almacenan y se detectan", async () => {
      const key = "invoice:HAP-2026-001:FE/1001 A";
      const take = (owner: string) =>
        runTx(async (tx) => {
          (await prepareUniques(tx, [{ key, owner, message: "Factura duplicada" }]))(tx);
        });
      await take("invoices/1");
      await expect(take("invoices/2")).rejects.toThrow(/Factura duplicada/);
    });
  });

  describe("anti pago doble (documento de compromiso)", () => {
    it("crear dos veces el mismo compromiso falla (ALREADY_EXISTS)", async () => {
      const c = commitment("col1", "asg1");
      await ref(C.commitments, c.id).create(c);
      await expect(ref(C.commitments, c.id).create(c)).rejects.toSatisfy(isAlreadyExists);
    });

    it("dos cierres simultáneos del mismo recaudo: solo uno compromete", async () => {
      const c = commitment("col2", "asg1");
      const close = (n: number) =>
        runTx(async (tx) => {
          const snap = await tx.get(ref(C.commitments, c.id));
          if (snap.exists) throw new SettledError("Ya liquidado");
          tx.create(ref(C.commitments, c.id), { ...c, lineId: `${c.lineId}#${n}` });
        });
      const results = await Promise.allSettled([close(1), close(2)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await col(C.commitments).get()).size).toBe(1);
    });

    it("isSettled / assertNotSettled consultan por recaudo, factura, asignación o proyecto", async () => {
      const c = commitment("col3", "asg9");
      await ref(C.commitments, c.id).create(c);
      await runTx(async (tx) => {
        expect(await isSettled(tx, "collectionId", "col3")).toBe(true);
        expect(await isSettled(tx, "collectionId", "otro")).toBe(false);
        expect(await isSettled(tx, "invoiceId", "inv1")).toBe(true);
        expect(await isSettled(tx, "assignmentId", "asg9")).toBe(true);
        expect(await isSettled(tx, "projectId", "HAP-1")).toBe(true);
        await expect(assertNotSettled(tx, "collectionId", "col3", "Recaudo liquidado")).rejects.toThrow(SettledError);
        await expect(assertNotSettled(tx, "collectionId", "libre", "x")).resolves.toBeUndefined();
      });
    });
  });

  describe("auditoría atómica", () => {
    it("el cambio y su registro se guardan juntos", async () => {
      const id = newId();
      await runTx(async (tx) => {
        tx.create(ref(C.collaborators, id), { id, fullName: "Ana" });
        audit(tx, { entity: "Collaborator", entityId: id, action: "CREATE", summary: "Colaborador creado", after: { id, fullName: "Ana", skip: undefined }, userId: "u1" });
      });
      const logs = await col(C.auditLog).get();
      expect(logs.size).toBe(1);
      const log = logs.docs[0].data();
      expect(log).toMatchObject({ entity: "Collaborator", entityId: id, action: "CREATE", userId: "u1", before: null });
      expect(log.after).toEqual({ id, fullName: "Ana" }); // `undefined` omitido
    });

    it("si la transacción falla no queda ni el cambio ni la bitácora", async () => {
      const id = newId();
      await expect(
        runTx(async (tx) => {
          tx.create(ref(C.collaborators, id), { id });
          audit(tx, { entity: "Collaborator", entityId: id, action: "CREATE", userId: null });
          throw new Error("falla de negocio");
        }),
      ).rejects.toThrow("falla de negocio");
      expect((await ref(C.collaborators, id).get()).exists).toBe(false);
      expect((await col(C.auditLog).get()).size).toBe(0);
    });

    it("jsonSafe convierte fechas y descarta undefined", () => {
      const out = jsonSafe({ a: new Date("2026-10-06T00:00:00Z"), b: undefined, c: [1, undefined] });
      expect(out).toEqual({ a: "2026-10-06T00:00:00.000Z", c: [1, null] });
    });
  });

  describe("escrituras grandes", () => {
    it("una transacción puede contener más de 500 escrituras (ya no hay tope de 500; el límite es el tamaño y 270 s)", async () => {
      await runTx(async (tx) => {
        for (let i = 0; i < 1200; i++) tx.create(ref(C.uniques, `k${i}`), { id: `k${i}` });
      });
      expect((await col(C.uniques).get()).size).toBe(1200);
    }, 60_000);

    it("estimateBytes / fitsInOneTx deciden entre transacción única y cierre por lotes", () => {
      const small = Array.from({ length: 300 }, (_, i) => ({ id: i, snapshot: "x".repeat(1500) }));
      expect(fitsInOneTx(small)).toBe(true);
      const huge = Array.from({ length: 8000 }, (_, i) => ({ id: i, snapshot: "x".repeat(1500) }));
      expect(fitsInOneTx(huge)).toBe(false);
    });

    it("commitInBatches escribe 1.050 documentos en lotes y es idempotente con set()", async () => {
      const ops = Array.from({ length: 1050 }, (_, i) => (w: Parameters<Parameters<typeof commitInBatches>[0][number]>[0]) => w.set(ref(C.uniques, `b${i}`), { id: `b${i}`, n: i }));
      expect(await commitInBatches(ops)).toBe(1050);
      expect((await col(C.uniques).get()).size).toBe(1050);
      await commitInBatches(ops); // reanudar no duplica
      expect((await col(C.uniques).get()).size).toBe(1050);
    }, 60_000);
  });

  describe("bloqueo de cierre por lotes", () => {
    it("sin cierre en curso las escrituras de negocio pasan", async () => {
      await expect(runTx((tx) => assertNotClosing(tx))).resolves.toBeUndefined();
    });

    it("con un cierre en curso se rechazan con un mensaje claro", async () => {
      await systemStateRef().set({ id: "state", closing: { settlementCode: "LIQ-2026-10", closingId: "x", startedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
      await expect(runTx((tx) => assertNotClosing(tx))).rejects.toThrow(ClosingInProgressError);
      await expect(runTx((tx) => assertNotClosing(tx))).rejects.toThrow(/LIQ-2026-10/);
      await systemStateRef().set({ id: "state", closing: null, updatedAt: new Date().toISOString() });
      await expect(runTx((tx) => assertNotClosing(tx))).resolves.toBeUndefined();
    });
  });

  it("la conexión usa el emulador", () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(db().databaseId).toBe("(default)");
  });
});
