# Design: SMS Consent, Gifts & Redemption, Waiter Role, Monthly Automations

**Date:** 2026-08-19
**Status:** Approved by owner (interactive brainstorming session)

## Background

oshioshiGederaSMS is a Next.js 14 (App Router) VIP-club app for the Oshi Oshi restaurant in Gedera, Israel. Hebrew UI. Postgres in production (Vercel) with a SQLite fallback for local dev (`lib/db.ts`). SMS is sent through the Android SMS Gateway (sms-gate.app) via `/api/send_sms_task`, with jobs queued through Upstash QStash (`lib/qstash.ts`). Every outgoing SMS auto-appends an unsubscribe link + reply keyword. One Vercel cron exists: `/api/cron/birthday_check` at `0 10 1 * *` (1st of month, 10:00 UTC = 13:00 Israel).

Before this work: consent is implied by a text line under the signup button (no checkbox, no stored proof); there is no anniversary automation (wedding_day is stored but unused); there is no gift/redemption system; auth is a single shared admin password → JWT `{admin: true}`.

## Decisions (owner-approved)

1. **Anniversary automation**: monthly, same 1st-of-month cron run as birthdays.
2. **Gift validity**: birthday/anniversary gifts valid only during their calendar month (Israel time); Joining Reward never expires.
3. **Waiter login**: one waiter account with username + password (env-configured).
4. **Terms**: new in-app Hebrew `/terms` page (combined club terms + privacy + SMS consent). Requires lawyer review before reliance.
5. **Consent checkbox**: required to join, unchecked by default.
6. **Existing customers**: grandfathered — keep receiving SMS; consent proof recorded only for new signups.
7. **Waiter gift view**: type + validity + status (available / not yet available / used with date).
8. **Gift labels**: generic Hebrew labels (מתנת יום הולדת / מתנת יום נישואין / מתנת הצטרפות); actual benefit decided in-restaurant.
9. **Gift model**: explicit `gifts` table (not derived entitlements).
10. **Joining Reward scope**: new signups only, no backfill.
11. **Brand name in SMS**: "Oshi Oshi Gedera" (replaces "Sushi VIP" in the existing birthday message too).

## Legal basis (research summary)

Israeli Spam Law — Communications Law §30A (Amendment 40):
- Marketing SMS ("דבר פרסומת") requires **express, prior, written consent**; electronic form consent qualifies, but a pre-checked box does not. Checkbox must be **unchecked by default**.
- Every promo SMS must state the **advertiser's name** and a **free, same-channel opt-out** (§30A(e)(2) reduced SMS format; the "פרסומת" prefix is not required for SMS).
- Sender bears the **burden of proving consent**; exposure is up to ₪1,000/message statutory damages, class-actionable. → store consent timestamp, exact text version, IP.
- A purely service message is not a דבר פרסומת, but any promotional content (e.g., mentioning a joining benefit) makes the whole message promotional — so the welcome SMS is sent only after form consent and carries name + opt-out.

Privacy Protection Law (incl. Amendment 13, in force 14.8.2025):
- No database registration needed for a small club.
- §11 notice at collection: purpose, voluntariness, recipients of the data, access/correction rights → provided by the `/terms` page linked from the checkbox.
- §§17E–17F direct-mail: right to demand deletion; identity of database owner stated.

## Design

### 1. Consent capture

- `VIPForm.tsx`: add a required, unchecked-by-default checkbox above the submit button, replacing the implied-consent paragraph:
  > אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם ל[תקנון המועדון ומדיניות הפרטיות](/terms). ניתן להסיר את ההסכמה בכל עת, ללא עלות, במענה "{keyword}" לכל הודעה או בקישור ההסרה שבה.
- `lib/consent.ts`: `CONSENT_VERSION` (e.g., `2026-08-19-v1`) and the canonical consent text, so the stored version can always be mapped back to the exact wording shown.
- `customers` gains `consent_at`, `consent_version`, `consent_ip` (nullable; null = grandfathered member).
- `/api/submit` rejects submissions without the checkbox (`error=consent`); on success stores the consent proof.

### 2. `/terms` page

Static Hebrew RTL server component. Sections: general & definitions (business identity), joining (voluntary data provision per §11), benefits (changeable, no double-dipping), §30A SMS consent, opt-out & deletion rights (§17F), privacy/data use (no third-party transfer except processing providers), security & retention, access/correction rights (§§13–14), minors (18+), changes to terms, governing law. Header comment + visible footnote: draft pending lawyer review.

### 3. Gifts subsystem

`gifts` table (Postgres + SQLite):

| column | notes |
|---|---|
| id | serial / autoincrement PK |
| phone | references customer |
| type | `joining` \| `birthday` \| `anniversary` |
| period | `once` (joining) or `YYYY-MM` |
| valid_from | `YYYY-MM-DD`, Israel-local date |
| valid_until | `YYYY-MM-DD` or NULL (never expires) |
| redeemed_at | timestamp, NULL until used |
| redeemed_by | e.g. `waiter` |
| created_at | default now |
| | `UNIQUE(phone, type, period)` |

- **Joining Reward**: inserted at successful signup. `valid_from` = signup date **+ 1 day** (Israel time), `valid_until` NULL. The unique key (`phone`,`joining`,`once`) means a re-subscribing customer can never get a second one.
- **Birthday/anniversary**: inserted by the monthly cron for members whose birth/wedding month equals the current Israel month; `valid_from` = 1st of month, `valid_until` = last day of month, `period` = `YYYY-MM`. Also inserted at signup when the customer's month is the current month (mid-month joiners). Insertions use insert-or-ignore, so cron re-runs cannot duplicate.
- **Redemption** is one atomic conditional UPDATE (`WHERE redeemed_at IS NULL AND valid_from <= today AND (valid_until IS NULL OR valid_until >= today)`); zero rows affected = already used or not valid today. This is the double-redemption guard — no read-then-write race.
- Gifts of inactive (`active = false`) customers are hidden from the waiter and not redeemable.

### 4. Roles & waiter account

- Session JWT gains `role: "admin" | "waiter"`; legacy `{admin: true}` tokens still verify as admin.
- `getAdminSession()` returns true only for role admin → all existing admin pages/APIs stay protected with no per-route changes. New `getSessionRole()` for waiter-or-admin gates.
- Login: form gains an optional username field. Empty or `admin` → admin password check (unchanged behavior). Matches `WAITER_USERNAME` → constant-time check against `WAITER_PASSWORD` → waiter session. Login response returns the role; client redirects waiter to `/waiter`.
- `/waiter` page + APIs: customer search by name/phone returning **only name + phone** (column-restricted in SQL, not just in UI) plus the customer's gifts (label, status, valid-until). "Mark as used" button with confirm step → `POST /api/waiter/redeem`.

### 5. Monthly cron (birthday + anniversary)

`/api/cron/birthday_check` (path and `0 10 1 * *` schedule unchanged — Vercel Hobby cron limits favor one entry) is extended to:
1. Compute current Israel month.
2. Issue birthday gifts for that month's celebrants and anniversary gifts for members with a matching wedding month — **before** any SMS, so gift issuance never depends on QStash.
3. Queue birthday SMS (existing Hebrew text, brand renamed to Oshi Oshi Gedera) and a new anniversary SMS via QStash.

### 6. Welcome SMS

Queued via QStash after a successful consented signup (fire-and-forget; a QStash failure never fails the signup). Text:

> Oshi Oshi Gedera: היי [שם], איזה כיף שהצטרפת אלינו! 🍣 מחכה לך מתנת הצטרפות במסעדה החל ממחר, ומעכשיו המבצעים, ההטבות וה-1+1 מגיעים ישירות אליך.

Opt-out footer is auto-appended by `/api/send_sms_task` as with all SMS.

### 7. Verification (no real SMS)

Delivered as `docs/verification-report.md`: env/config audit (gateway, QStash, CRON_SECRET, webhook secret), cron schedule confirmation (1st of month — already correct), and vitest coverage of gift issuance, validity windows, day-after rule, atomic redemption, consent validation, and role auth — all with the SMS gateway / QStash calls mocked. No message leaves the system during testing.

## Out of scope

Per-waiter named accounts, configurable gift benefits, re-consent campaign for existing members, exact-day anniversary delivery.

## Testing strategy

Vitest (existing setup). DB-touching gift logic is tested against in-memory better-sqlite3 `DbConnection` objects; network calls (`fetch`) are stubbed with `vi.stubGlobal`. Existing test conventions in `tests/` are followed.
