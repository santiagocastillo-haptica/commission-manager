import { NextResponse, type NextRequest } from "next/server";
import { collaboratorMayAccess } from "@/lib/access";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Chequeo optimista de sesión: redirige a /login si no hay una sesión válida.
 * La autorización real se vuelve a verificar dentro de cada Server Action y página (requireSession).
 */
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Un colaborador solo puede ver su propia página y descargar sus propios reportes.
  if (session.role === "COLLABORATOR" && !collaboratorMayAccess(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/mi-cuenta", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
