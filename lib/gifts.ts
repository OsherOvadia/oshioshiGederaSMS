import type { DbConnection } from "./db";
import { queryCustomers, runDb } from "./db";
import { getBirthMonth, israelToday } from "./dates";

export type GiftType = "joining" | "birthday" | "anniversary";

export const GIFT_LABELS: Record<GiftType, string> = {
  joining: "מתנת הצטרפות",
  birthday: "מתנת יום הולדת",
  anniversary: "מתנת יום נישואין",
};

export type GiftRow = {
  id: number;
  phone: string;
  type: GiftType;
  period: string; // 'once' for joining, 'YYYY-MM' for birthday/anniversary
  valid_from: string; // YYYY-MM-DD, Israel-local
  valid_until: string | null; // YYYY-MM-DD or null = never expires
  redeemed_at: string | null;
  redeemed_by: string | null;
};

export type GiftStatus = "available" | "not_yet" | "used" | "expired";

/** YYYY-MM-DD strings compare correctly as plain strings — no Date parsing needed. */
export function giftStatus(g: GiftRow, today: string = israelToday()): GiftStatus {
  if (g.redeemed_at) return "used";
  if (today < g.valid_from) return "not_yet";
  if (g.valid_until && today > g.valid_until) return "expired";
  return "available";
}

/** 'YYYY-MM' period key for an Israel-local date 'YYYY-MM-DD'. */
export function monthPeriod(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** First and last calendar day of a 'YYYY-MM' period. */
export function monthBounds(period: string): { from: string; until: string } {
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, until: `${period}-${String(lastDay).padStart(2, "0")}` };
}

/** isoDate + n days as pure calendar arithmetic (no timezone involved). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function mapGiftRow(r: Record<string, unknown>): GiftRow {
  return {
    id: Number(r.id),
    phone: String(r.phone ?? ""),
    type: String(r.type ?? "") as GiftType,
    period: String(r.period ?? ""),
    valid_from: String(r.valid_from ?? ""),
    valid_until: r.valid_until != null ? String(r.valid_until) : null,
    redeemed_at: r.redeemed_at != null ? String(r.redeemed_at) : null,
    redeemed_by: r.redeemed_by != null ? String(r.redeemed_by) : null,
  };
}
