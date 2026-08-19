import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "admin_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getSecret(): Uint8Array {
  const secret = process.env.SECRET_KEY;
  if (!secret || secret === "CHANGE_THIS_TO_A_LONG_RANDOM_STRING") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SECRET_KEY must be set in production");
    }
    return new TextEncoder().encode("dev-secret-key");
  }
  return new TextEncoder().encode(secret);
}

export function getCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: "lax"; maxAge: number; path: string } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  };
}

export type SessionRole = "admin" | "waiter";

export async function createSessionJwt(role: SessionRole = "admin"): Promise<string> {
  // `admin: true` kept on admin tokens for backward compatibility with
  // sessions issued before roles existed.
  const claims: Record<string, unknown> = role === "admin" ? { role, admin: true } : { role };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
  return token;
}

/** Role carried by a session token, or null when missing/invalid/expired. */
export async function getTokenRole(token: string): Promise<SessionRole | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role === "waiter") return "waiter";
    if (payload.role === "admin" || payload.admin === true) return "admin";
    return null;
  } catch {
    return null;
  }
}

/** Admin-only check — every existing admin surface gates on this. */
export async function verifySessionToken(token: string): Promise<boolean> {
  return (await getTokenRole(token)) === "admin";
}
