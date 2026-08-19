import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SignJWT } from "jose";
import { createSessionJwt, getTokenRole, verifySessionToken, getSecret } from "@/lib/session-jwt";
import { verifyWaiterCredentials } from "@/lib/admin-auth";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("session roles", () => {
  it("admin token has role admin and passes verifySessionToken", async () => {
    const token = await createSessionJwt("admin");
    expect(await getTokenRole(token)).toBe("admin");
    expect(await verifySessionToken(token)).toBe(true);
  });
  it("waiter token has role waiter and FAILS the admin check", async () => {
    const token = await createSessionJwt("waiter");
    expect(await getTokenRole(token)).toBe("waiter");
    expect(await verifySessionToken(token)).toBe(false);
  });
  it("legacy {admin:true} tokens (issued before roles) still count as admin", async () => {
    const legacy = await new SignJWT({ admin: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(getSecret());
    expect(await getTokenRole(legacy)).toBe("admin");
  });
  it("garbage tokens have no role", async () => {
    expect(await getTokenRole("not-a-jwt")).toBe(null);
  });
});

describe("verifyWaiterCredentials", () => {
  it("accepts the configured username/password (username case-insensitive)", () => {
    process.env.WAITER_USERNAME = "melzar";
    process.env.WAITER_PASSWORD = "s3cret!";
    expect(verifyWaiterCredentials("melzar", "s3cret!")).toBe(true);
    expect(verifyWaiterCredentials("MELZAR", "s3cret!")).toBe(true);
    expect(verifyWaiterCredentials("melzar", "wrong")).toBe(false);
    expect(verifyWaiterCredentials("other", "s3cret!")).toBe(false);
  });
  it("rejects everything when the waiter account is not configured", () => {
    delete process.env.WAITER_USERNAME;
    delete process.env.WAITER_PASSWORD;
    expect(verifyWaiterCredentials("", "")).toBe(false);
    expect(verifyWaiterCredentials("melzar", "s3cret!")).toBe(false);
  });
});
