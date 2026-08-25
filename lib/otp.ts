import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { getAppSecret } from "./security";

/**
 * Primitives for the SMS one-time-password that gates club signup. Everything
 * here is pure and side-effect free (no I/O) so the security-relevant choices —
 * uniform randomness, keyed hashing, constant-time comparison — can be unit
 * tested on their own. The stateful half lives in lib/phone-verification.ts.
 */

export const OTP_LENGTH = 6;
/** A code is usable for 10 minutes; SMS delivery is rarely slower than that. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Guesses allowed per issued code. 5 of 1,000,000 is a 1-in-200,000 shot. */
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between two SMS to the same number. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Rolling window for the per-number send cap. */
export const OTP_SEND_WINDOW_MS = 60 * 60 * 1000;
export const OTP_MAX_SENDS_PER_WINDOW = 5;
/** How long a verified phone stays "spendable" as one club signup. */
export const SIGNUP_TOKEN_TTL_MS = 15 * 60 * 1000;

const SIGNUP_TOKEN_BYTES = 32;
/** Hex length of a signup token — used as a cheap shape check before hashing. */
export const SIGNUP_TOKEN_HEX_LENGTH = SIGNUP_TOKEN_BYTES * 2;

/**
 * A uniformly random decimal code. `randomInt` rejection-samples, so unlike
 * `randomBytes(n) % 10` every code is equally likely; `Math.random` must never
 * be used here — it is seeded predictably and is not a CSPRNG.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

/**
 * Codes are never stored in the clear. HMAC (not a bare hash) keyed by the app
 * secret means a database leak alone does not let an attacker pre-compute the
 * mere million possible 6-digit codes.
 */
export function hashOtp(phone: string, code: string): string {
  return createHmac("sha256", getAppSecret()).update(`otp:${phone}:${code}`).digest("hex");
}

export function generateSignupToken(): string {
  return randomBytes(SIGNUP_TOKEN_BYTES).toString("hex");
}

/** Bound to the phone, so a token minted for one number can't sign up another. */
export function hashSignupToken(phone: string, token: string): string {
  return createHmac("sha256", getAppSecret()).update(`signup:${phone}:${token}`).digest("hex");
}

/** Constant-time comparison of two hex digests; length mismatch is a fast no. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Normalize whatever the client typed into bare digits (strips spaces, dashes). */
export function normalizeOtpInput(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\D/g, "").slice(0, OTP_LENGTH) : "";
}

export function isOtpCodeShaped(value: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}
