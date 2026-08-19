# Verification Report — SMS, Cron, Gifts (2026-08-19)

No real SMS was sent at any point during this verification. Android SMS Gateway and QStash credentials were never present in the environment (no `ANDROID_SMS_GATEWAY_*`, no `QSTASH_TOKEN`). A temporary `.env.local` containing only dummy `CRON_SECRET`, `WAITER_USERNAME`, and `WAITER_PASSWORD` values was created for the smoke test and deleted afterward. All SMS code paths were verified inert: every cron and signup queue attempt reported `queued: 0`, exactly as designed when `QSTASH_TOKEN` is absent.

Environment: Windows 11, Node 22.12.0, Next.js 14.2.35, SQLite (`better-sqlite3`), dev server on http://localhost:3000. `customers.db` was backed up before the smoke test and restored from the backup afterward (post-restore check: 0 test rows, no `gifts` table — identical to pre-test state).

## SMS configuration

- **Provider**: Android SMS Gateway (sms-gate.app) via HTTP Basic auth in `app/api/send_sms_task/route.ts`. Confirmed by code inspection: reads `ANDROID_SMS_GATEWAY_LOGIN`, `ANDROID_SMS_GATEWAY_PASSWORD`, `ANDROID_SMS_GATEWAY_API_URL` (default `https://api.sms-gate.app/3rdparty/v1`). Same env vars used by `app/api/admin/send-test/route.ts`.
- **Queue**: Upstash QStash — `QSTASH_TOKEN` gates publishing in `app/api/submit/route.ts` (welcome SMS), `app/api/cron/birthday_check/route.ts`, and `app/api/admin/broadcast/route.ts`; optional `QSTASH_URL` (EU region) handled in `lib/qstash.ts`. Verified by `tests/lib/qstash.test.ts`: **10/10 tests passed**.
- **Opt-out footer**: appended in `send_sms_task` and honored by the inbound keyword webhook (`app/api/sms/incoming`). Verified by `tests/lib/unsubscribe-webhook.test.ts`: **7/7 tests passed**.
- **Sender identification**: every message starts with "Oshi Oshi Gedera". Verified by `tests/lib/sms-messages.test.ts`: **3/3 tests passed**.

## Cron jobs

- `vercel.json` declares exactly **one** cron: path `/api/cron/birthday_check`, schedule `0 10 1 * *` = 1st of every month at 10:00 UTC (13:00 Israel). Matches the monthly-automation requirement.
- **Auth**: `GET /api/cron/birthday_check` without secret → **HTTP 401**. With `?secret=test-cron-secret-12345` (the dummy `CRON_SECRET`) → **HTTP 200**.
- **Birthday + anniversary automation** (smoke run, with one test customer born 1990-08-15 just created): response was `{"status":"success","birthdays":{"found":1,"queued":0},"anniversaries":{"found":0,"queued":0}}`. Gifts were issued despite QStash being absent (birthday gift row present in DB), and `queued: 0` confirms no SMS publish was attempted.
- **Idempotency**: immediate re-run returned the identical JSON and the `gifts` table row count was unchanged (2 rows before re-run, 2 rows after).

## Gift data wiring

- **Joining reward next-day rule**: smoke-observed joining gift row: `type=joining, period=once, valid_from=2026-08-20, valid_until=NULL` — valid from the next Israel day (created 2026-08-19 Israel time) and never expires. Covered by `tests/lib/gifts-db.test.ts`.
- **Birthday/anniversary calendar-month bounds**: smoke-observed birthday gift row: `type=birthday, period=2026-08, valid_from=2026-08-01, valid_until=2026-08-31` — exact calendar-month bounds for the signup month matching the DOB month. Covered by `tests/lib/gifts-db.test.ts` and `tests/lib/gifts-helpers.test.ts`.
- **Atomic redemption / double-redeem refusal**: first `POST /api/waiter/redeem {"giftId":2}` → `{"ok":true}` (200); the same request repeated → `{"ok":false,"error":"unavailable"}` (409). Covered by `tests/lib/gifts-db.test.ts` (13/13 passed) and `tests/api/waiter.test.ts` (10/10 passed).
- **Not-yet-valid refusal**: redeeming the joining gift (status `not_yet`, valid from tomorrow) → `{"ok":false,"error":"unavailable"}` (409).
- **Inactive-customer refusal**: covered by `tests/lib/gifts-db.test.ts` (part of the 13 passing tests); not separately exercised in the smoke test.

## Consent

- **Checkbox required**: `GET /` returned 200 and the HTML contains `name="consent"` and the label text `אני מאשר/ת קבלת הודעות SMS`. `POST /api/submit` with all valid fields but **no** consent → `{"success":false,"error":"consent"}`. Same POST with `consent=on` → `{"success":true,"error":null}`.
- **Proof columns recorded** (actual values read from `customers.db` for phone `+972501234999`): `consent_at = 2026-08-19T19:55:46.937Z`, `consent_version = 2026-08-19-v1`, `consent_ip = ::1` (localhost).
- **Hebrew integrity**: a UTF-8 submission (`name=בדיקה`) stored byte-identically (verified `row.name === 'בדיקה'`, length 5). One earlier smoke row showed `?????` — that was a Windows curl argument-encoding artifact in the test harness, not an app defect.
- **/terms live**: `GET /terms` → **HTTP 200**, page contains `תקנון מועדון הלקוחות`.

## Waiter role

- **Login**: `POST /api/login` with `username=melzar`, `password=waiter-test-pass` → **200** `{"ok":true,"role":"waiter"}` (session cookie set).
- **Wrong password** → **401** `{"ok":false,"error":"wrong"}`.
- **Restricted fields**: `GET /api/waiter/customers?q=0501234999` with the waiter cookie returned the customer with **exactly** the JSON keys `phone`, `name`, `gifts` (no email, city, dates, or consent data). Each gift exposed `id`, `type`, `label`, `status`, `valid_from`, `valid_until`, `redeemed_at`. Observed statuses: joining gift `not_yet`, birthday gift `available`.
- **Redeem once / 409 twice**: birthday gift redeem → 200 `{"ok":true}`; repeat with same `giftId` → 409 `{"ok":false,"error":"unavailable"}`.
- **not_yet blocked**: joining gift redeem → 409 `{"ok":false,"error":"unavailable"}`.
- **/admin blocked**: `GET /admin` with the waiter cookie → **HTTP 307 redirect to /login** (no admin content served).

## Test suite

- `npm test` (vitest): **19 test files passed, 144 tests passed, 0 failed** (duration ~5.9s).
- `npx tsc --noEmit`: **exit 0, no type errors**.
- `npm run build` (Next.js 14.2.35 production build): **succeeded** — 25 pages generated, including `/terms` (static) and `/waiter`, `/api/waiter/customers`, `/api/waiter/redeem`, `/api/cron/birthday_check` (dynamic).
- Post-test hygiene: dev server stopped, `customers.db` restored from backup, temporary `.env.local` deleted; `git status` shows no tracked-file changes from the smoke test (only the pre-existing `.gitignore` modification unrelated to this verification).

## Gaps / follow-ups

- `/terms` content needs lawyer sign-off before launch.
- Production Postgres receives the new schema (consent columns + gifts table) lazily on first request after deploy — verify once post-deploy.
- `WAITER_USERNAME` / `WAITER_PASSWORD` must be set in the Vercel environment for the waiter login to work in production.
- `QSTASH_TOKEN` plus `ANDROID_SMS_GATEWAY_LOGIN`/`PASSWORD` (and optionally `QSTASH_URL`, `ANDROID_SMS_GATEWAY_API_URL`) are required in production for actual SMS sending; without them all sends remain silent no-ops.
