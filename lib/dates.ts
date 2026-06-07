/**
 * Extract the birth month (1-12) from a stored date-of-birth string.
 * DOB is stored as free-text, so handle ISO (YYYY-MM-DD) and the
 * Israeli day-first formats (DD/MM/YYYY, DD.MM.YYYY). Returns null when
 * the string cannot be parsed into a valid month, so callers can skip it.
 */
export function getBirthMonth(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const s = dob.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return clampMonth(parseInt(iso[2], 10));

  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (dayFirst) return clampMonth(parseInt(dayFirst[2], 10));

  return null;
}

function clampMonth(m: number): number | null {
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

// The business runs in Gedera, Israel — "today" must be the local Israeli day,
// not the server's UTC day, or signups/removals in the early hours bucket wrong.
const ISRAEL_TZ = "Asia/Jerusalem";
const israelDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ISRAEL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Parse a stored timestamp into a Date. created_at/received_message_at/
 * unsubscribed_at are stored in UTC: Postgres CURRENT_TIMESTAMP and SQLite
 * datetime('now') produce "YYYY-MM-DD HH:MM:SS" with no zone, and ISO strings
 * we write carry a trailing Z. Treat zone-less "YYYY-MM-DD HH:MM:SS" as UTC so
 * the instant is correct regardless of where the code runs.
 */
function parseStoredTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const s = value.trim();
  const looksLikeNaiveDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (looksLikeNaiveDateTime && !hasZone) {
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

/** Today's date (YYYY-MM-DD) in Israel local time. */
export function israelToday(): string {
  return israelDateFmt.format(new Date());
}

/**
 * Convert a stored UTC timestamp to its Israel-local calendar date
 * (YYYY-MM-DD), or null if the value is empty/unparseable.
 */
export function toIsraelDateStr(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = parseStoredTimestamp(value);
  if (Number.isNaN(d.getTime())) return null;
  return israelDateFmt.format(d);
}
