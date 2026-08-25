import { describe, it, expect, beforeAll } from "vitest";
import {
  OTP_LENGTH,
  SIGNUP_TOKEN_HEX_LENGTH,
  generateOtpCode,
  generateSignupToken,
  hashOtp,
  hashSignupToken,
  isOtpCodeShaped,
  normalizeOtpInput,
  safeEqualHex,
} from "@/lib/otp";

beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-key-for-otp-unit-tests";
});

describe("generateOtpCode", () => {
  it("always produces exactly OTP_LENGTH digits, leading zeros kept", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(isOtpCodeShaped(code)).toBe(true);
    }
  });

  it("does not repeat itself (would signal a broken RNG)", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateOtpCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("hashOtp", () => {
  it("is deterministic for the same phone and code", () => {
    expect(hashOtp("+972501234567", "123456")).toBe(hashOtp("+972501234567", "123456"));
  });

  it("binds the code to the phone number", () => {
    expect(hashOtp("+972501234567", "123456")).not.toBe(hashOtp("+972509999999", "123456"));
  });

  it("never returns the code itself", () => {
    const hash = hashOtp("+972501234567", "123456");
    expect(hash).not.toContain("123456");
    expect(hash).toHaveLength(64);
  });
});

describe("hashSignupToken", () => {
  it("binds a token to one phone number, so it cannot be spent on another", () => {
    const token = generateSignupToken();
    expect(hashSignupToken("+972501234567", token)).not.toBe(hashSignupToken("+972509999999", token));
  });

  it("mints unguessable, correctly sized tokens", () => {
    const a = generateSignupToken();
    const b = generateSignupToken();
    expect(a).toHaveLength(SIGNUP_TOKEN_HEX_LENGTH);
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a).not.toBe(b);
  });
});

describe("safeEqualHex", () => {
  it("matches identical digests and rejects everything else", () => {
    const digest = hashOtp("+972501234567", "123456");
    expect(safeEqualHex(digest, digest)).toBe(true);
    expect(safeEqualHex(digest, hashOtp("+972501234567", "123457"))).toBe(false);
    expect(safeEqualHex(digest, digest.slice(0, 10))).toBe(false);
    expect(safeEqualHex(digest, "")).toBe(false);
  });
});

describe("normalizeOtpInput", () => {
  it("keeps digits from however the customer typed the code", () => {
    expect(normalizeOtpInput(" 123 456 ")).toBe("123456");
    expect(normalizeOtpInput("123-456")).toBe("123456");
  });

  it("truncates overlong input and rejects non-strings", () => {
    expect(normalizeOtpInput("1234567890")).toBe("123456");
    expect(normalizeOtpInput(null)).toBe("");
    expect(normalizeOtpInput(123456)).toBe("");
  });

  it("does not treat a short or empty code as valid", () => {
    expect(isOtpCodeShaped(normalizeOtpInput("12345"))).toBe(false);
    expect(isOtpCodeShaped(normalizeOtpInput("abcdef"))).toBe(false);
  });
});
