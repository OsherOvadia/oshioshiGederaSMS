import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionJwt, getCookieOptions } from "@/lib/session-jwt";
import { verifyAdminPassword, verifyWaiterCredentials } from "@/lib/admin-auth";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "login", LIMITS.login.max);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let username = "";
  let password = "";
  try {
    const form = await req.formData();
    username = ((form.get("username") as string) ?? "").trim();
    password = (form.get("password") as string) ?? "";
  } catch {
    const body = await req.json().catch(() => ({}));
    username = ((body as { username?: string }).username ?? "").trim();
    password = (body as { password?: string }).password ?? "";
  }

  // Misconfiguration guard: WAITER_USERNAME="admin" would make the waiter
  // account unreachable (the admin branch below shadows it).
  if ((process.env.WAITER_USERNAME ?? "").trim().toLowerCase() === "admin") {
    console.warn("WAITER_USERNAME is set to 'admin' — the waiter account is unreachable");
  }

  // No username (or "admin") = the owner logging in with the admin password,
  // exactly as before. Any other username is checked against the waiter account.
  if (!username || username.toLowerCase() === "admin") {
    if (verifyAdminPassword(password)) {
      const token = await createSessionJwt("admin");
      const res = NextResponse.json({ ok: true, role: "admin" });
      res.cookies.set(COOKIE_NAME, token, getCookieOptions());
      return res;
    }
  } else if (verifyWaiterCredentials(username, password)) {
    const token = await createSessionJwt("waiter");
    const res = NextResponse.json({ ok: true, role: "waiter" });
    res.cookies.set(COOKIE_NAME, token, getCookieOptions());
    return res;
  }

  return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
}
