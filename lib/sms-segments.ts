/**
 * Hebrew SMS is always UCS-2 (any char outside GSM 03.38 forces the whole
 * message to UCS-2, and every Hebrew letter is outside it). Billing counts
 * UTF-16 code units — which is exactly JS string.length. Astral-plane emoji
 * are surrogate pairs and correctly cost 2.
 */
export const UCS2_SINGLE = 70;
export const UCS2_MULTI = 67; // 6-byte concat header = 3 UCS-2 chars per part

export function smsUnits(text: string): number {
  return text.length;
}

export function segmentsForUnits(units: number): number {
  if (units <= 0) return 0;
  return units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_MULTI);
}

export function smsSegments(text: string): number {
  return segmentsForUnits(smsUnits(text));
}

const SAMPLE_PHONE_DIGITS = "972501234567";
const SAMPLE_TOKEN = "x".repeat(32); // generateSecureToken (lib/security.ts) emits 32 hex chars (.slice(0,32))

/**
 * Estimated UTF-16 length of the footer the SMS worker appends
 * (see app/api/send_sms_task/route.ts):
 *   "\n\nלהסרה: השב/י {keyword} או לחצ/י כאן: {link}"
 * Token length and recipient number vary by a few chars — treat as ≈.
 */
export function estimateUnsubFooterUnits(
  keyword = "1111",
  baseUrl = "https://example.vercel.app"
): number {
  const link = `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${SAMPLE_PHONE_DIGITS}?token=${SAMPLE_TOKEN}`;
  return `\n\nלהסרה: השב/י ${keyword} או לחצ/י כאן: ${link}`.length;
}
