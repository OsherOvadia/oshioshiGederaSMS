import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  createSessionJwt,
  getTokenRole,
  getCookieOptions,
  type SessionRole,
} from "./session-jwt";

export async function setSession(role: SessionRole): Promise<void> {
  const token = await createSessionJwt(role);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, getCookieOptions());
}

/** Role of the current session, refreshing the cookie when valid. */
export async function getSessionRole(): Promise<SessionRole | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const role = await getTokenRole(token);
    if (!role) return null;
    try {
      await setSession(role);
    } catch {
      // Cookie refresh failed; token is still valid, allow access
    }
    return role;
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<boolean> {
  return (await getSessionRole()) === "admin";
}

/** Call this on any admin API response (redirect or file) so the browser keeps the session. */
export async function attachSessionCookie(res: NextResponse, role: SessionRole): Promise<NextResponse> {
  const token = await createSessionJwt(role);
  res.cookies.set(COOKIE_NAME, token, getCookieOptions());
  return res;
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
