import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { confirmPhoneVerification } from "@/lib/phone-verification";
import { formatPhone, isValidPhone } from "@/lib/validation";
import { isOtpCodeShaped, normalizeOtpInput } from "@/lib/otp";
import { isPhoneVerificationRequired } from "@/lib/features";

/**
 * Step 2 of signup: check the code that was texted to the customer. Success
 * returns a single-use token bound to that phone number, which /api/submit
 * spends to create the membership. The browser never gets to assert "verified"
 * on its own — the token is minted here and validated server-side there.
 */
export const dynamic = "force-dynamic";

export type VerifyError =
  | "verification_disabled"
  | "invalid_phone"
  | "invalid_code"
  | "expired"
  | "no_code"
  | "too_many_attempts"
  | "rate"
  | "system";

function fail(error: VerifyError, extra: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  // Unreachable from the current UI when the switch is off, but a stale tab or
  // a stray client should get a clear answer rather than a confusing "no_code".
  if (!isPhoneVerificationRequired()) return fail("verification_disabled");

  const ip = await getClientIp();
  const { ok: underLimit } = await checkRateLimit(ip, "signup_verify", LIMITS.signupVerify.max);
  if (!underLimit) return fail("rate", {}, 429);

  let rawPhone: unknown;
  let rawCode: unknown;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { phone?: unknown; code?: unknown };
      rawPhone = body?.phone;
      rawCode = body?.code;
    } else {
      const form = await req.formData();
      rawPhone = form.get("phone");
      rawCode = form.get("code");
    }
  } catch {
    return fail("invalid_code");
  }

  const phone = formatPhone(typeof rawPhone === "string" ? rawPhone.slice(0, 20) : "");
  if (!isValidPhone(phone)) return fail("invalid_phone");

  const code = normalizeOtpInput(rawCode);
  // Shape-check before touching the database, but report it as a wrong code so
  // the response says nothing about how codes are built.
  if (!isOtpCodeShaped(code)) return fail("invalid_code");

  try {
    await initDb();
    const db = getDb();
    try {
      const result = await confirmPhoneVerification(db, phone, code);
      if (!result.ok) {
        return fail(
          result.error,
          result.error === "invalid_code" ? { attemptsLeft: result.attemptsLeft } : {}
        );
      }
      return NextResponse.json({
        ok: true,
        phone,
        verificationToken: result.token,
        expiresInSec: result.expiresInSec,
      });
    } finally {
      if (db.type === "sqlite") db.conn.close();
    }
  } catch (e) {
    console.error("Signup verify error:", e);
    return fail("system");
  }
}
