import { describe, it, expect } from "vitest";
import { normalizeAdminPhone } from "@/lib/validation";

describe("normalizeAdminPhone", () => {
  it("keeps a well-formed +972 number", () => {
    expect(normalizeAdminPhone("+972501234567")).toEqual({
      formatted: "+972501234567",
      clean: "972501234567",
    });
  });
  it("prefixes + onto a 972 number with no plus", () => {
    expect(normalizeAdminPhone("972501234567").formatted).toBe("+972501234567");
  });
  it("prefixes + onto a bare digit string", () => {
    expect(normalizeAdminPhone("0501234567").formatted).toBe("+0501234567");
  });
  it("strips non-digits for the clean form", () => {
    expect(normalizeAdminPhone("+972-50-123-4567").clean).toBe("972501234567");
  });
  it("caps the formatted value at 20 chars", () => {
    expect(normalizeAdminPhone("+9725012345670000000000").formatted.length).toBe(20);
  });
});
