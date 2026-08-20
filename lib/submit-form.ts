import { formatPhone, isValidEmail, isValidPhone } from "./validation";
import { isAtLeastAge, israelToday } from "./dates";

/** Club membership is adults-only: the club advertises a bar, and Israeli
 *  consumer-protection regulations require guardian consent to market to a
 *  minor's phone number at any age under 18. See app/terms. */
export const MIN_SIGNUP_AGE = 18;

export type SubmitError = "missing" | "invalid_phone" | "invalid_email" | "underage" | "consent";

export type ParsedSubmit =
  | {
      ok: true;
      fields: { name: string; phone: string; email: string; dob: string; wedding: string; city: string };
    }
  | { ok: false; error: SubmitError };

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Validate and normalize the VIP signup fields. Wedding day is optional —
 * it's a nice-to-have for the anniversary treat, not a gate to joining.
 */
export function parseSubmitFields(raw: {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  date_of_birth?: unknown;
  wedding_day?: unknown;
  city?: unknown;
  consent?: unknown;
}, today: string = israelToday()): ParsedSubmit {
  const name = str(raw.name, 100);
  const rawPhone = str(raw.phone, 20);
  const email = str(raw.email, 255);
  const dob = str(raw.date_of_birth, 10);
  const wedding = str(raw.wedding_day, 10);
  const city = str(raw.city, 50);

  if (!name || !rawPhone || !email || !dob || !city) return { ok: false, error: "missing" };

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) return { ok: false, error: "invalid_phone" };
  if (!isValidEmail(email)) return { ok: false, error: "invalid_email" };
  // Fails closed: an unparseable date of birth cannot prove adulthood.
  if (!isAtLeastAge(dob, MIN_SIGNUP_AGE, today)) return { ok: false, error: "underage" };

  // HTML checkboxes submit "on" when checked and are absent when not.
  const consentGiven = raw.consent === "on" || raw.consent === "1" || raw.consent === "true" || raw.consent === true;
  if (!consentGiven) return { ok: false, error: "consent" };

  return { ok: true, fields: { name, phone, email, dob, wedding, city } };
}
