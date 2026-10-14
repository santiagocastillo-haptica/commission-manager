import { describe, expect, it } from "vitest";
import { collaboratorMayAccess } from "@/lib/access";

describe("rutas permitidas a un colaborador", () => {
  it("solo su página y la descarga de reportes individuales", () => {
    expect(collaboratorMayAccess("/mi-cuenta")).toBe(true);
    expect(collaboratorMayAccess("/api/liquidaciones/LIQ-2026-10/individual/abc123")).toBe(true);
    expect(collaboratorMayAccess("/api/liquidaciones/LIQ-2026-10/bonificacion/abc123")).toBe(true);
  });
  it("nada de administración, ni reportes de todos", () => {
    for (const p of ["/", "/proyectos", "/proyectos/AVAL-01", "/facturas", "/colaboradores", "/colaboradores/x", "/liquidaciones", "/liquidaciones/LIQ-2026-10", "/configuracion", "/mi-cuentas", "/mi-cuenta-x",
      "/api/liquidaciones/LIQ-2026-10/zip", "/api/liquidaciones/LIQ-2026-10/administrativo", "/api/diagnostico/reportes", "/api/liquidaciones/LIQ-2026-10/individual", "/api/liquidaciones/LIQ-2026-10/individual/a/b", "/api/liquidaciones/otra/individual/abc"]) {
      expect(collaboratorMayAccess(p), p).toBe(false);
    }
  });
});
