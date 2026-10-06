import { jwtVerify, SignJWT } from "jose";

/** Sesión firmada (JWT HS256) guardada en una cookie httpOnly. Compatible con el runtime del proxy. */

export const SESSION_COOKIE = "hcm_session";
export const SESSION_HOURS = 8;

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN";
}

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return {
      userId: String(payload.userId),
      email: String(payload.email),
      name: String(payload.name),
      role: "ADMIN",
    };
  } catch {
    return null;
  }
}
