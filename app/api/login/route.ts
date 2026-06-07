import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionJwt, getCookieOptions } from "@/lib/session-jwt";
import { verifyAdminPassword } from "@/lib/admin-auth";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "login", LIMITS.login.max);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let password = "";
  try {
    const form = await req.formData();
    password = (form.get("password") as string) ?? "";
  } catch {
    const body = await req.json().catch(() => ({}));
    password = (body as { password?: string }).password ?? "";
  }

  if (verifyAdminPassword(password)) {
    const token = await createSessionJwt();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, getCookieOptions());
    return res;
  }

  return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
}
