import { describe, it, expect, beforeAll } from "vitest";
import { applySchema, queryCustomers, type DbConnection } from "@/lib/db";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
  SIGNUP_TOKEN_TTL_MS,
} from "@/lib/otp";
import {
  confirmPhoneVerification,
  consumeSignupToken,
  purgeStalePhoneVerifications,
  startPhoneVerification,
} from "@/lib/phone-verification";

const PHONE = "+972501234567";
const OTHER_PHONE = "+972509999999";
const T0 = Date.parse("2026-08-25T10:00:00.000Z");

beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-key-for-phone-verification";
});

async function freshDb(): Promise<DbConnection> {
  const BetterSqlite3 = require("better-sqlite3");
  const db = { type: "sqlite", conn: BetterSqlite3(":memory:") } as DbConnection;
  await applySchema(db);
  return db;
}

/** Drive a number through start + confirm, returning the minted signup token. */
async function verified(db: DbConnection, phone = PHONE, at = T0): Promise<string> {
  const started = await startPhoneVerification(db, phone, at);
  if (!started.ok) throw new Error(`start failed: ${started.error}`);
  const confirmed = await confirmPhoneVerification(db, phone, started.code, at + 1000);
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.error}`);
  return confirmed.token;
}

describe("startPhoneVerification", () => {
  it("issues a code and never stores it in the clear", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const row = (await queryCustomers(db, "SELECT * FROM phone_verifications WHERE phone = $1", [PHONE]))[0];
    expect(row).toBeDefined();
    expect(String(row.code_hash)).not.toContain(started.code);
    expect(String(row.code_hash)).toHaveLength(64);
    expect(Number(row.attempts)).toBe(0);
    expect(Number(row.send_count)).toBe(1);
  });

  it("refuses a resend inside the cooldown", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    const second = await startPhoneVerification(db, PHONE, T0 + OTP_RESEND_COOLDOWN_MS - 1000);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("cooldown");
    expect(second.retryAfterSec).toBeGreaterThan(0);
  });

  it("allows a resend once the cooldown has passed", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    const second = await startPhoneVerification(db, PHONE, T0 + OTP_RESEND_COOLDOWN_MS);
    expect(second.ok).toBe(true);
  });

  it("caps sends per number per window, and the cap survives across requests", async () => {
    const db = await freshDb();
    let at = T0;
    for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
      const r = await startPhoneVerification(db, PHONE, at);
      expect(r.ok).toBe(true);
      at += OTP_RESEND_COOLDOWN_MS;
    }
    const over = await startPhoneVerification(db, PHONE, at);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error).toBe("too_many_sends");
  });

  it("starts a fresh window once the old one has rolled off", async () => {
    const db = await freshDb();
    let at = T0;
    for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
      await startPhoneVerification(db, PHONE, at);
      at += OTP_RESEND_COOLDOWN_MS;
    }
    const afterWindow = await startPhoneVerification(db, PHONE, T0 + OTP_SEND_WINDOW_MS + 1);
    expect(afterWindow.ok).toBe(true);
  });

  it("throttles each number independently", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    const other = await startPhoneVerification(db, OTHER_PHONE, T0);
    expect(other.ok).toBe(true);
  });

  it("invalidates a signup token already minted for the number", async () => {
    const db = await freshDb();
    const token = await verified(db);
    await startPhoneVerification(db, PHONE, T0 + OTP_RESEND_COOLDOWN_MS);
    expect(await consumeSignupToken(db, PHONE, token, T0 + OTP_RESEND_COOLDOWN_MS + 1000)).toBe(false);
  });
});

describe("confirmPhoneVerification", () => {
  it("accepts the right code and mints a token", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    const result = await confirmPhoneVerification(db, PHONE, started.code, T0 + 5000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("destroys the code once it has been used", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    await confirmPhoneVerification(db, PHONE, started.code, T0 + 5000);
    const replay = await confirmPhoneVerification(db, PHONE, started.code, T0 + 6000);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error).toBe("no_code");
  });

  it("rejects a wrong code and counts down the remaining attempts", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    const wrong = started.code === "000000" ? "111111" : "000000";
    const result = await confirmPhoneVerification(db, PHONE, wrong, T0 + 1000);
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_code") throw new Error("expected invalid_code");
    expect(result.attemptsLeft).toBe(OTP_MAX_ATTEMPTS - 1);
  });

  it("locks the code after OTP_MAX_ATTEMPTS wrong guesses, even if the next guess is right", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    const wrong = started.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await confirmPhoneVerification(db, PHONE, wrong, T0 + 1000 + i);
    }
    const correct = await confirmPhoneVerification(db, PHONE, started.code, T0 + 9000);
    expect(correct.ok).toBe(false);
    if (correct.ok) return;
    expect(correct.error).toBe("too_many_attempts");
  });

  it("rejects an expired code", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    const result = await confirmPhoneVerification(db, PHONE, started.code, T0 + OTP_TTL_MS + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("expired");
  });

  it("reports no_code for a number that never requested one", async () => {
    const db = await freshDb();
    const result = await confirmPhoneVerification(db, PHONE, "123456", T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_code");
  });

  it("will not accept another number's code", async () => {
    const db = await freshDb();
    const started = await startPhoneVerification(db, PHONE, T0);
    if (!started.ok) throw new Error("start failed");
    await startPhoneVerification(db, OTHER_PHONE, T0);
    const result = await confirmPhoneVerification(db, OTHER_PHONE, started.code, T0 + 1000);
    // Same six digits by coincidence would be a 1-in-a-million flake; the codes
    // are hashed with the phone mixed in, so even a collision would not verify.
    expect(result.ok === false && result.error === "invalid_code").toBe(true);
  });
});

describe("consumeSignupToken", () => {
  it("spends a fresh token exactly once", async () => {
    const db = await freshDb();
    const token = await verified(db);
    expect(await consumeSignupToken(db, PHONE, token, T0 + 2000)).toBe(true);
    expect(await consumeSignupToken(db, PHONE, token, T0 + 3000)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const db = await freshDb();
    const token = await verified(db);
    expect(await consumeSignupToken(db, PHONE, token, T0 + SIGNUP_TOKEN_TTL_MS + 5000)).toBe(false);
  });

  it("rejects a token spent against a different phone number", async () => {
    const db = await freshDb();
    const token = await verified(db);
    await verified(db, OTHER_PHONE);
    expect(await consumeSignupToken(db, OTHER_PHONE, token, T0 + 2000)).toBe(false);
    // ...and the rightful owner's token is untouched by the failed attempt.
    expect(await consumeSignupToken(db, PHONE, token, T0 + 2000)).toBe(true);
  });

  it("rejects malformed, missing and forged tokens", async () => {
    const db = await freshDb();
    await verified(db);
    for (const bad of [undefined, null, "", "not-a-token", "z".repeat(64), 12345, "a".repeat(64)]) {
      expect(await consumeSignupToken(db, PHONE, bad, T0 + 2000)).toBe(false);
    }
  });

  it("rejects any token for a number with no verification row", async () => {
    const db = await freshDb();
    expect(await consumeSignupToken(db, PHONE, "a".repeat(64), T0)).toBe(false);
  });
});

describe("purgeStalePhoneVerifications", () => {
  const MONTH = 30 * 24 * 60 * 60 * 1000;

  it("leaves a row that is still inside the retention window", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    expect(await purgeStalePhoneVerifications(db, T0 + MONTH - 1000)).toBe(0);
    const after = await startPhoneVerification(db, PHONE, T0 + OTP_RESEND_COOLDOWN_MS);
    // Still throttled as the second send of the same window, not a fresh row.
    expect(after.ok && after.sendsLeft).toBe(OTP_MAX_SENDS_PER_WINDOW - 2);
  });

  it("drops a row nobody has touched for longer than the retention window", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    expect(await purgeStalePhoneVerifications(db, T0 + MONTH + 1000)).toBe(1);
    const rows = await queryCustomers(db, "SELECT phone FROM phone_verifications", []);
    expect(rows).toHaveLength(0);
  });

  it("a purged number simply starts over", async () => {
    const db = await freshDb();
    await startPhoneVerification(db, PHONE, T0);
    await purgeStalePhoneVerifications(db, T0 + MONTH + 1000);
    const fresh = await startPhoneVerification(db, PHONE, T0 + MONTH + 2000);
    expect(fresh.ok).toBe(true);
  });
});
