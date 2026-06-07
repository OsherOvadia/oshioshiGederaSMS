import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { generateSecureToken, verifyToken } from "@/lib/security";

const SECRET = "unit-test-secret-key";
beforeEach(() => {
  process.env.SECRET_KEY = SECRET;
  process.env.NODE_ENV = "test";
});

function legacyToken(phone: string): string {
  const data = `${phone}:${SECRET}`;
  return createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 16);
}

describe("unsubscribe token", () => {
  const phone = "+972501234567";

  it("generates a 32-char (128-bit) hex token", () => {
    const t = generateSecureToken(phone);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
  it("verifies a freshly generated token", () => {
    expect(verifyToken(phone, generateSecureToken(phone))).toBe(true);
  });
  it("still verifies a legacy 16-char token (backward compat)", () => {
    expect(verifyToken(phone, legacyToken(phone))).toBe(true);
  });
  it("rejects a token for a different phone", () => {
    expect(verifyToken("+972500000000", generateSecureToken(phone))).toBe(false);
  });
  it("rejects a garbage token", () => {
    expect(verifyToken(phone, "deadbeef")).toBe(false);
  });
});
