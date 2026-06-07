import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { isUnsubscribeKeyword, verifySmsWebhookSignature } from "@/lib/unsubscribe";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UNSUBSCRIBE_KEYWORD;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isUnsubscribeKeyword", () => {
  it("matches the default keyword 1111 (trimmed)", () => {
    expect(isUnsubscribeKeyword("1111")).toBe(true);
    expect(isUnsubscribeKeyword("  1111  ")).toBe(true);
  });
  it("rejects other text and empty/nullish", () => {
    expect(isUnsubscribeKeyword("hello")).toBe(false);
    expect(isUnsubscribeKeyword("1111 please")).toBe(false);
    expect(isUnsubscribeKeyword("")).toBe(false);
    expect(isUnsubscribeKeyword(null)).toBe(false);
    expect(isUnsubscribeKeyword(undefined)).toBe(false);
  });
  it("respects a custom keyword from env (case-insensitive)", () => {
    process.env.UNSUBSCRIBE_KEYWORD = "STOP";
    expect(isUnsubscribeKeyword("stop")).toBe(true);
    expect(isUnsubscribeKeyword("1111")).toBe(false);
  });
});

describe("verifySmsWebhookSignature", () => {
  const secret = "webhook-secret";
  const rawBody = '{"event":"sms:received","payload":{"sender":"+972501234567","message":"1111"}}';
  const timestamp = "1700000000";
  const validSig = createHmac("sha256", secret).update(rawBody + timestamp).digest("hex");

  it("accepts a correct HMAC over rawBody + timestamp", () => {
    expect(verifySmsWebhookSignature(rawBody, timestamp, validSig, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySmsWebhookSignature(rawBody + "x", timestamp, validSig, secret)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    expect(verifySmsWebhookSignature(rawBody, timestamp, validSig, "nope")).toBe(false);
  });
  it("rejects missing signature/timestamp/secret", () => {
    expect(verifySmsWebhookSignature(rawBody, timestamp, null, secret)).toBe(false);
    expect(verifySmsWebhookSignature(rawBody, null, validSig, secret)).toBe(false);
    expect(verifySmsWebhookSignature(rawBody, timestamp, validSig, "")).toBe(false);
  });
});
