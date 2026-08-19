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

/**
 * YYYY-MM-DD strings compare correctly as plain strings — no Date parsing needed.
 * Precedence: used > not_yet > expired > available — a redeemed gift reports
 * 'used' even outside its validity window.
 */
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
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`monthBounds: expected 'YYYY-MM' period, got '${period}'`);
  }
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, until: `${period}-${String(lastDay).padStart(2, "0")}` };
}

/** isoDate + n days as pure calendar arithmetic (no timezone involved). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const GIFT_TYPES: readonly GiftType[] = ["joining", "birthday", "anniversary"];

function toGiftType(v: unknown): GiftType {
  const s = String(v ?? "");
  if ((GIFT_TYPES as readonly string[]).includes(s)) return s as GiftType;
  throw new Error(`Unknown gift type: ${s}`);
}

export function mapGiftRow(r: Record<string, unknown>): GiftRow {
  return {
    id: Number(r.id),
    phone: String(r.phone ?? ""),
    type: toGiftType(r.type),
    period: String(r.period ?? ""),
    valid_from: String(r.valid_from ?? ""),
    valid_until: r.valid_until != null ? String(r.valid_until) : null,
    redeemed_at: r.redeemed_at != null ? String(r.redeemed_at) : null,
    redeemed_by: r.redeemed_by != null ? String(r.redeemed_by) : null,
  };
}

/**
 * Insert a gift; the UNIQUE(phone, type, period) key makes re-issues a no-op.
 * Returns true when a new row was actually created.
 */
export async function issueGift(
  db: DbConnection,
  gift: { phone: string; type: GiftType; period: string; validFrom: string; validUntil: string | null }
): Promise<boolean> {
  const sql =
    db.type === "postgres"
      ? `INSERT INTO gifts (phone, type, period, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (phone, type, period) DO NOTHING`
      : `INSERT OR IGNORE INTO gifts (phone, type, period, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5)`;
  const { rowCount } = await runDb(db, sql, [gift.phone, gift.type, gift.period, gift.validFrom, gift.validUntil]);
  return rowCount > 0;
}

/**
 * Gifts granted at signup: the Joining Reward (usable from the NEXT Israel-local
 * day, never expires), plus this month's birthday/anniversary gift when the
 * customer's celebration month is the current month (so mid-month joiners
 * aren't skipped by the cron that already ran on the 1st).
 * Returns whether the joining gift was actually created — false means a
 * re-subscriber whose joining reward (possibly redeemed) already exists.
 */
export async function issueSignupGifts(
  db: DbConnection,
  customer: { phone: string; dob: string; wedding: string },
  today: string = israelToday()
): Promise<{ joiningIssued: boolean }> {
  const period = monthPeriod(today);
  const bounds = monthBounds(period);
  const currentMonth = parseInt(period.slice(5, 7), 10);
  const joiningIssued = await issueGift(db, { phone: customer.phone, type: "joining", period: "once", validFrom: addDays(today, 1), validUntil: null });
  // getBirthMonth parses the month out of any stored date string (dob or wedding).
  if (getBirthMonth(customer.dob) === currentMonth) {
    await issueGift(db, { phone: customer.phone, type: "birthday", period, validFrom: bounds.from, validUntil: bounds.until });
  }
  if (customer.wedding && getBirthMonth(customer.wedding) === currentMonth) {
    await issueGift(db, { phone: customer.phone, type: "anniversary", period, validFrom: bounds.from, validUntil: bounds.until });
  }
  return { joiningIssued };
}

/**
 * Monthly cron: issue this month's birthday + anniversary gifts for all active
 * members and return the celebrant lists (for SMS queuing). Idempotent —
 * re-runs re-return the celebrants but create no duplicate gifts.
 */
export async function issueMonthlyGifts(
  db: DbConnection,
  today: string = israelToday()
): Promise<{ birthday: [string, string][]; anniversary: [string, string][] }> {
  const period = monthPeriod(today);
  const bounds = monthBounds(period);
  const currentMonth = parseInt(period.slice(5, 7), 10);
  const activeCondition = db.type === "postgres" ? "WHERE active = TRUE" : "WHERE active = 1";
  const rows = await queryCustomers(
    db,
    `SELECT phone, name, date_of_birth, wedding_day FROM customers ${activeCondition}`,
    []
  );
  const birthday: [string, string][] = [];
  const anniversary: [string, string][] = [];
  for (const row of rows) {
    const phone = String(row.phone);
    const name = String(row.name ?? "");
    if (getBirthMonth(row.date_of_birth as string) === currentMonth) {
      await issueGift(db, { phone, type: "birthday", period, validFrom: bounds.from, validUntil: bounds.until });
      birthday.push([phone, name]);
    }
    if (getBirthMonth(row.wedding_day as string) === currentMonth) {
      await issueGift(db, { phone, type: "anniversary", period, validFrom: bounds.from, validUntil: bounds.until });
      anniversary.push([phone, name]);
    }
  }
  return { birthday, anniversary };
}

/**
 * Atomically redeem a gift. The single conditional UPDATE is the
 * double-redemption guard: two concurrent attempts can't both match
 * `redeemed_at IS NULL`. Also enforces the validity window and that the
 * customer is still an active member.
 * NOTE: the SQLite shim maps $N -> positional ?, so `today` is bound twice
 * ($4 and $5) instead of reusing one placeholder.
 */
export async function redeemGift(
  db: DbConnection,
  giftId: number,
  redeemedBy: string,
  today: string = israelToday()
): Promise<boolean> {
  const now = new Date().toISOString();
  const activeTrue = db.type === "postgres" ? "TRUE" : "1";
  const { rowCount } = await runDb(
    db,
    `UPDATE gifts SET redeemed_at = $1, redeemed_by = $2
     WHERE id = $3
       AND redeemed_at IS NULL
       AND valid_from <= $4
       AND (valid_until IS NULL OR valid_until >= $5)
       AND phone IN (SELECT phone FROM customers WHERE active = ${activeTrue})`,
    [now, redeemedBy, giftId, today, today]
  );
  return rowCount > 0;
}

export type WaiterGift = {
  id: number;
  type: GiftType;
  label: string;
  status: GiftStatus;
  valid_from: string;
  valid_until: string | null;
  redeemed_at: string | null;
};

export type WaiterCustomer = { phone: string; name: string; gifts: WaiterGift[] };

/**
 * Waiter-facing search: matches active customers by partial name or phone
 * digits and returns ONLY name + phone + gifts. The column restriction lives
 * here in the SQL, not in the UI.
 */
export async function searchCustomersWithGifts(
  db: DbConnection,
  rawQuery: string,
  today: string = israelToday()
): Promise<WaiterCustomer[]> {
  const q = String(rawQuery ?? "").trim().slice(0, 50);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  // Phones are stored E.164 (+9725x...); a waiter will type the local 05x...
  // form, so normalize a leading 0 to the 972 country code before matching.
  const normDigits = digits.startsWith("0") ? "972" + digits.slice(1) : digits;
  // Escape LIKE wildcards in the name pattern so "%%" can't match everyone
  // and defeat the min-length guard. (digits already strips non-digits, so
  // the phone clause needs no escaping.)
  const escaped = q.replace(/[\\%_]/g, (ch) => "\\" + ch);
  const activeCondition = db.type === "postgres" ? "active = TRUE" : "active = 1";
  const nameOp = db.type === "postgres" ? "ILIKE" : "LIKE";
  const phoneClause = digits ? " OR REPLACE(phone, '+', '') LIKE $2" : "";
  const params: unknown[] = digits ? [`%${escaped}%`, `%${normDigits}%`] : [`%${escaped}%`];
  const custRows = await queryCustomers(
    db,
    `SELECT phone, name FROM customers WHERE ${activeCondition} AND (name ${nameOp} $1 ESCAPE '\\'${phoneClause}) ORDER BY name ASC LIMIT 20`,
    params
  );
  if (custRows.length === 0) return [];
  const phones = custRows.map((r) => String(r.phone));
  const placeholders = phones.map((_, i) => `$${i + 1}`).join(", ");
  const giftRows = await queryCustomers(
    db,
    `SELECT id, phone, type, period, valid_from, valid_until, redeemed_at, redeemed_by
     FROM gifts WHERE phone IN (${placeholders}) ORDER BY id ASC`,
    phones
  );
  const byPhone = new Map<string, WaiterGift[]>();
  for (const raw of giftRows) {
    const g = mapGiftRow(raw);
    const status = giftStatus(g, today);
    // Expired gifts can never be redeemed — leave them off the tablet.
    if (status === "expired") continue;
    const list = byPhone.get(g.phone) ?? [];
    list.push({
      id: g.id,
      type: g.type,
      label: GIFT_LABELS[g.type] ?? g.type,
      status,
      valid_from: g.valid_from,
      valid_until: g.valid_until,
      redeemed_at: g.redeemed_at,
    });
    byPhone.set(g.phone, list);
  }
  return custRows.map((r) => ({
    phone: String(r.phone),
    name: String(r.name ?? ""),
    gifts: byPhone.get(String(r.phone)) ?? [],
  }));
}
