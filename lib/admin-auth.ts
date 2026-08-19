import { timingSafeEqual } from "crypto";

function getAdminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_PASSWORD must be set in production");
    }
    return "admin";
  }
  return pw;
}

/** Constant-time admin password check. Throws in production if no password is configured. */
export function verifyAdminPassword(input: string): boolean {
  const expected = getAdminPassword();
  const a = Buffer.from(String(input ?? ""), "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual requires equal-length buffers, so a length mismatch can't
  // be constant-time. Acceptable here: the login route is rate-limited, so the
  // sub-microsecond length side-channel is not a realistic attack vector.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Single waiter account from env. Both vars must be set for the account to
 * exist at all; username matches case-insensitively, password exactly.
 */
export function verifyWaiterCredentials(username: string, password: string): boolean {
  const expectedUser = (process.env.WAITER_USERNAME ?? "").trim();
  const expectedPass = process.env.WAITER_PASSWORD ?? "";
  if (!expectedUser || !expectedPass) return false;
  return (
    constantTimeEquals(String(username ?? "").trim().toLowerCase(), expectedUser.toLowerCase()) &&
    constantTimeEquals(String(password ?? ""), expectedPass)
  );
}
