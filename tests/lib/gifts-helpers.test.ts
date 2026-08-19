import { describe, it, expect } from "vitest";
import { monthPeriod, monthBounds, addDays, giftStatus, mapGiftRow, GIFT_LABELS, type GiftRow } from "@/lib/gifts";

function gift(overrides: Partial<GiftRow>): GiftRow {
  return {
    id: 1,
    phone: "+972501234567",
    type: "joining",
    period: "once",
    valid_from: "2026-08-20",
    valid_until: null,
    redeemed_at: null,
    redeemed_by: null,
    ...overrides,
  };
}

describe("period helpers", () => {
  it("monthPeriod extracts YYYY-MM", () => {
    expect(monthPeriod("2026-08-19")).toBe("2026-08");
  });
  it("monthBounds handles 31-day, 30-day, and February months", () => {
    expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", until: "2026-08-31" });
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", until: "2026-04-30" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", until: "2028-02-29" }); // leap
  });
  it("monthBounds rejects non-YYYY-MM input", () => {
    expect(() => monthBounds("once")).toThrow(/YYYY-MM/);
    expect(() => monthBounds("2026")).toThrow(/YYYY-MM/);
  });
  it("addDays rolls over month and year ends", () => {
    expect(addDays("2026-08-19", 1)).toBe("2026-08-20");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("giftStatus", () => {
  it("is not_yet before valid_from (day-after rule for joining gifts)", () => {
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2026-08-19")).toBe("not_yet");
  });
  it("is available from valid_from, forever when valid_until is null", () => {
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2026-08-20")).toBe("available");
    expect(giftStatus(gift({ valid_from: "2026-08-20" }), "2027-01-05")).toBe("available");
  });
  it("is expired after valid_until", () => {
    const g = gift({ type: "birthday", period: "2026-08", valid_from: "2026-08-01", valid_until: "2026-08-31" });
    expect(giftStatus(g, "2026-09-01")).toBe("expired");
    expect(giftStatus(g, "2026-08-31")).toBe("available");
  });
  it("is used once redeemed, regardless of dates", () => {
    expect(giftStatus(gift({ redeemed_at: "2026-08-21T10:00:00Z" }), "2026-08-25")).toBe("used");
  });
  it("is used even when redeemed and the validity window has already expired", () => {
    const g = gift({
      type: "birthday",
      period: "2026-08",
      valid_from: "2026-08-01",
      valid_until: "2026-08-31",
      redeemed_at: "2026-08-10T10:00:00Z",
    });
    expect(giftStatus(g, "2026-09-15")).toBe("used");
  });
  it("is used even when redeemed before valid_from", () => {
    const g = gift({ valid_from: "2026-08-20", redeemed_at: "2026-08-10T10:00:00Z" });
    expect(giftStatus(g, "2026-08-15")).toBe("used");
  });
});

describe("mapGiftRow", () => {
  it("throws on an unknown gift type", () => {
    expect(() =>
      mapGiftRow({
        id: 1,
        phone: "+972501234567",
        type: "bogus",
        period: "once",
        valid_from: "2026-08-20",
        valid_until: null,
        redeemed_at: null,
        redeemed_by: null,
      })
    ).toThrow(/Unknown gift type/);
  });
});

describe("labels", () => {
  it("has a Hebrew label per type", () => {
    expect(GIFT_LABELS.joining).toBe("מתנת הצטרפות");
    expect(GIFT_LABELS.birthday).toBe("מתנת יום הולדת");
    expect(GIFT_LABELS.anniversary).toBe("מתנת יום נישואין");
  });
});
