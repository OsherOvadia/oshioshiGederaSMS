import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyAdminPassword } from "@/lib/admin-auth";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("verifyAdminPassword", () => {
  it("returns true for the correct password", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("s3cret-pass")).toBe(true);
  });
  it("returns false for the wrong password", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("nope")).toBe(false);
  });
  it("returns false for a wrong password of different length", () => {
    process.env.ADMIN_PASSWORD = "s3cret-pass";
    process.env.NODE_ENV = "test";
    expect(verifyAdminPassword("x")).toBe(false);
  });
  it("throws in production when ADMIN_PASSWORD is unset", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "production";
    expect(() => verifyAdminPassword("anything")).toThrow(/ADMIN_PASSWORD/);
  });
  it("falls back to 'admin' only outside production", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "development";
    expect(verifyAdminPassword("admin")).toBe(true);
  });
});
