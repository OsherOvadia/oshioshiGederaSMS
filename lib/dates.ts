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
