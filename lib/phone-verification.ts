import type { DbConnection } from "./db";
import { queryCustomers, runDb } from "./db";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
  SIGNUP_TOKEN_HEX_LENGTH,
  SIGNUP_TOKEN_TTL_MS,
  generateOtpCode,
  generateSignupToken,
  hashOtp,
  hashSignupToken,
  safeEqualHex,
} from "./otp";

/**
 * The stateful half of SMS phone verification: one `phone_verifications` row
 * per number, holding the in-flight code and the throttle counters.
 *
 * Two rules shape every function here:
 *   1. Nothing the browser sends is trusted — the code is compared against a
 *      server-side HMAC, and the resulting authorisation is a server-minted
 *      token, not a boolean flag the client could set.
 *   2. The per-number throttles live in the database, not in memory or in the
 *      IP rate limiter, so rotating IP addresses (or a serverless cold start)
 *      cannot reset them.
 *
 * Every `$n` placeholder appears in ascending order in each statement: lib/db.ts
 * rewrites them to positional `?` for SQLite, so out-of-order or reused numbers
 * would silently bind the wrong values there.
 */

const UPSERT_CODE_SQL = `
  INSERT INTO phone_verifications
    (phone, code_hash, code_expires_at, attempts, send_window_start, send_count, last_sent_at, token_hash, token_expires_at, updated_at)
  VALUES ($1, $2, $3, 0, $4, $5, $6, NULL, NULL, $7)
  ON CONFLICT(phone) DO UPDATE SET
    code_hash = excluded.code_hash,
    code_expires_at = excluded.code_expires_at,
    attempts = 0,
    send_window_start = excluded.send_window_start,
    send_count = excluded.send_count,
    last_sent_at = excluded.last_sent_at,
    token_hash = NULL,
    token_expires_at = NULL,
    updated_at = excluded.updated_at
`;

export type StartResult =
  | { ok: true; code: string; expiresInSec: number; resendInSec: number; sendsLeft: number }
  | { ok: false; error: "cooldown" | "too_many_sends"; retryAfterSec: number };

export type ConfirmResult =
  | { ok: true; token: string; expiresInSec: number }
  | { ok: false; error: "no_code" | "expired" | "too_many_attempts" }
  | { ok: false; error: "invalid_code"; attemptsLeft: number };

function parseIso(value: unknown): number {
  if (value == null) return NaN;
  // Postgres may hand back a Date for a TIMESTAMP column; our columns are TEXT,
  // but be tolerant so a hand-migrated database doesn't fail closed forever.
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : NaN;
}

function secondsUntil(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Issue (or re-issue) a code for `phone` and return it so the caller can send
 * the SMS. The code is stored hashed; this return value is the only moment the
 * plaintext exists server-side, and it must never reach an HTTP response.
 *
 * Re-issuing invalidates the previous code *and* any signup token already
 * minted for the number, so a resend can never leave two live credentials.
 */
export async function startPhoneVerification(
  db: DbConnection,
  phone: string,
  now: number = Date.now()
): Promise<StartResult> {
  const rows = await queryCustomers(
    db,
    "SELECT send_count, send_window_start, last_sent_at FROM phone_verifications WHERE phone = $1",
    [phone]
  );
  const row = rows[0];

  const lastSent = parseIso(row?.last_sent_at);
  if (Number.isFinite(lastSent) && now - lastSent < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, error: "cooldown", retryAfterSec: secondsUntil(OTP_RESEND_COOLDOWN_MS - (now - lastSent)) };
  }

  const windowStart = parseIso(row?.send_window_start);
  const inWindow = Number.isFinite(windowStart) && now - windowStart < OTP_SEND_WINDOW_MS;
  const sendCount = inWindow ? Number(row?.send_count ?? 0) : 0;
  if (inWindow && sendCount >= OTP_MAX_SENDS_PER_WINDOW) {
    return { ok: false, error: "too_many_sends", retryAfterSec: secondsUntil(OTP_SEND_WINDOW_MS - (now - windowStart)) };
  }

  const code = generateOtpCode();
  const nowIso = new Date(now).toISOString();
  await runDb(db, UPSERT_CODE_SQL, [
    phone,
    hashOtp(phone, code),
    new Date(now + OTP_TTL_MS).toISOString(),
    inWindow ? new Date(windowStart).toISOString() : nowIso,
    sendCount + 1,
    nowIso,
    nowIso,
  ]);

  return {
    ok: true,
    code,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    resendInSec: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
    sendsLeft: Math.max(0, OTP_MAX_SENDS_PER_WINDOW - (sendCount + 1)),
  };
}

/**
 * Check a submitted code. On success the code is destroyed and replaced by a
 * single-use signup token — possession of the token, not the code, is what
 * lets /api/submit create the membership.
 */
export async function confirmPhoneVerification(
  db: DbConnection,
  phone: string,
  code: string,
  now: number = Date.now()
): Promise<ConfirmResult> {
  const rows = await queryCustomers(
    db,
    "SELECT code_hash, code_expires_at, attempts FROM phone_verifications WHERE phone = $1",
    [phone]
  );
  const row = rows[0];
  if (!row || row.code_hash == null || String(row.code_hash) === "") {
    return { ok: false, error: "no_code" };
  }

  const attempts = Number(row.attempts ?? 0);
  if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" };

  const expiresAt = parseIso(row.code_expires_at);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return { ok: false, error: "expired" };

  // Burn the attempt *before* comparing. A crash, a timeout, or a client that
  // hangs up mid-request must not hand the caller a free guess.
  const nowIso = new Date(now).toISOString();
  await runDb(db, "UPDATE phone_verifications SET attempts = attempts + 1, updated_at = $1 WHERE phone = $2", [
    nowIso,
    phone,
  ]);

  if (!safeEqualHex(hashOtp(phone, code), String(row.code_hash))) {
    return { ok: false, error: "invalid_code", attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts - 1) };
  }

  const token = generateSignupToken();
  await runDb(
    db,
    `UPDATE phone_verifications
     SET code_hash = NULL, code_expires_at = NULL, attempts = 0,
         token_hash = $1, token_expires_at = $2, updated_at = $3
     WHERE phone = $4`,
    [hashSignupToken(phone, token), new Date(now + SIGNUP_TOKEN_TTL_MS).toISOString(), nowIso, phone]
  );

  return { ok: true, token, expiresInSec: Math.floor(SIGNUP_TOKEN_TTL_MS / 1000) };
}

/**
 * Spend the signup token for `phone`, returning true exactly once. The check
 * and the clear are a single conditional UPDATE, so two concurrent submits of
 * the same token can never both be told "yes" — the second matches no row.
 *
 * `token_expires_at > $4` is a lexicographic TEXT comparison, which is correct
 * because every stored instant is a fixed-width UTC ISO string.
 */
export async function consumeSignupToken(
  db: DbConnection,
  phone: string,
  token: unknown,
  now: number = Date.now()
): Promise<boolean> {
  if (typeof token !== "string" || token.length !== SIGNUP_TOKEN_HEX_LENGTH || !/^[0-9a-f]+$/.test(token)) {
    return false;
  }
  const nowIso = new Date(now).toISOString();
  const { rowCount } = await runDb(
    db,
    `UPDATE phone_verifications
     SET token_hash = NULL, token_expires_at = NULL, updated_at = $1
     WHERE phone = $2 AND token_hash = $3 AND token_expires_at > $4`,
    [nowIso, phone, hashSignupToken(phone, token), nowIso]
  );
  return rowCount === 1;
}

/**
 * Drop verification rows that are past both their code expiry and their
 * send window, so the table stays roughly "numbers seen this month" rather than
 * growing forever. Called from the monthly cron; safe to run at any time,
 * because a purged row simply means the next request starts a fresh window.
 */
export async function purgeStalePhoneVerifications(
  db: DbConnection,
  now: number = Date.now(),
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000
): Promise<number> {
  const cutoff = new Date(now - maxAgeMs).toISOString();
  const { rowCount } = await runDb(
    db,
    "DELETE FROM phone_verifications WHERE updated_at IS NULL OR updated_at < $1",
    [cutoff]
  );
  return rowCount;
}
