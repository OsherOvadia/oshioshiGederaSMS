import { formatPhone, isValidEmail, isValidPhone } from "./validation";

export type SubmitError = "missing" | "invalid_phone" | "invalid_email";

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
}): ParsedSubmit {
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

  return { ok: true, fields: { name, phone, email, dob, wedding, city } };
}
