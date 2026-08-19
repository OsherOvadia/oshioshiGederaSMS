/**
 * Consent versioning: consent_version stored on the customer row must map
 * back to the exact wording the customer saw (burden of proof is on the
 * sender under Israeli Spam Law §30A). Bump the version whenever
 * CONSENT_TEXT changes, and never edit a past version's text.
 */
export const CONSENT_VERSION = "2026-08-19-v1";

export const CONSENT_TEXT =
  'אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם לתקנון המועדון ומדיניות הפרטיות. ניתן להסיר את ההסכמה בכל עת, ללא עלות, במענה לכל הודעה או בקישור ההסרה שבה.';
