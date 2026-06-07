const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  const clean = p.replace(/\D/g, "");
  if (clean.startsWith("05") && clean.length === 10) return "+972" + clean.slice(1);
  if (clean.startsWith("5") && clean.length === 9) return "+972" + clean; // Israeli mobile without leading 0
  if (clean.startsWith("972") && clean.length === 12) return "+" + clean;
  return clean;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidPhone(phone: string): boolean {
  return phone.length >= 10 && phone.startsWith("+");
}

/**
 * Normalize an admin-supplied phone for block/unblock lookups.
 * Returns both the `formatted` (+E.164-ish, capped at 20 chars) and the
 * digits-only `clean` form used for a fallback LIKE match.
 */
export function normalizeAdminPhone(phone: string): { formatted: string; clean: string } {
  let formatted = phone.startsWith(" ") ? "+" + phone.trimStart() : phone;
  const clean = formatted.replace(/\D/g, "");
  if (clean.startsWith("972")) formatted = "+" + clean;
  else if (!formatted.startsWith("+")) formatted = "+" + clean;
  formatted = formatted.slice(0, 20);
  return { formatted, clean };
}
