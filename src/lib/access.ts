/**
 * Rutas que puede abrir un usuario con rol COLABORADOR: su propia página y la descarga de sus reportes
 * (el servidor vuelve a verificar que el reporte sea el suyo). Todo lo demás es solo para administradores.
 */
export function collaboratorMayAccess(pathname: string): boolean {
  if (pathname === "/mi-cuenta" || pathname.startsWith("/mi-cuenta/")) return true;
  return /^\/api\/liquidaciones\/LIQ-\d{4}-(04|10)\/(individual|bonificacion)\/[^/]+\/?$/.test(pathname);
}
