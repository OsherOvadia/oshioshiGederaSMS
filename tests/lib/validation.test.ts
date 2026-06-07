import { describe, it, expect } from "vitest";
import { formatPhone, isValidEmail, isValidPhone } from "@/lib/validation";

describe("formatPhone", () => {
  it("converts a local 05X number to +972 E.164", () => {
    expect(formatPhone("0501234567")).toBe("+972501234567");
  });
  it("converts a 9-digit 5X number to +972", () => {
    expect(formatPhone("501234567")).toBe("+972501234567");
  });
  it("prefixes + onto a 972 number", () => {
    expect(formatPhone("972501234567")).toBe("+972501234567");
  });
  it("returns empty string for nullish input", () => {
    expect(formatPhone(undefined)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });
  it("rejects a string without @", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});

describe("isValidPhone", () => {
  it("accepts a +-prefixed 10+ digit phone", () => {
    expect(isValidPhone("+972501234567")).toBe(true);
  });
  it("rejects a phone without +", () => {
    expect(isValidPhone("0501234567")).toBe(false);
  });
});
