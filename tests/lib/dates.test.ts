import { describe, it, expect } from "vitest";
import { getBirthMonth } from "@/lib/dates";

describe("getBirthMonth", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(getBirthMonth("1990-03-15")).toBe(3);
  });
  it("parses Israeli day-first DD/MM/YYYY", () => {
    expect(getBirthMonth("15/03/1990")).toBe(3);
  });
  it("parses dotted DD.MM.YYYY", () => {
    expect(getBirthMonth("15.03.1990")).toBe(3);
  });
  it("parses single-digit day/month with 2-digit year", () => {
    expect(getBirthMonth("5/7/90")).toBe(7);
  });
  it("returns null for empty/nullish", () => {
    expect(getBirthMonth("")).toBeNull();
    expect(getBirthMonth(null)).toBeNull();
    expect(getBirthMonth(undefined)).toBeNull();
  });
  it("returns null for unparseable text", () => {
    expect(getBirthMonth("not a date")).toBeNull();
  });
  it("returns null for an out-of-range month", () => {
    expect(getBirthMonth("1990-13-01")).toBeNull();
  });
});
