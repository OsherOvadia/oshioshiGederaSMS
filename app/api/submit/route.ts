import { NextRequest, NextResponse } from "next/server";
import { getDb, runDb, queryCustomers, initDb } from "@/lib/db";
import { parseSubmitFields, type SubmitError } from "@/lib/submit-form";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export type SubmitErrorKey = SubmitError | "already_registered" | "system" | "rate";

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

function jsonResponse(ok: boolean, error?: SubmitErrorKey) {
  return NextResponse.json({ success: ok, error: error ?? null });
}

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "submit", LIMITS.submit.max);
  if (!ok) {
    if (wantsJson(req)) return jsonResponse(false, "rate");
    return NextResponse.redirect(new URL("/?error=rate", req.url));
  }

  const form = await req.formData();
  const parsed = parseSubmitFields({
    name: form.get("name"),
    phone: form.get("phone"),
    email: form.get("email"),
    date_of_birth: form.get("date_of_birth"),
    wedding_day: form.get("wedding_day"),
    city: form.get("city"),
  });

  if (!parsed.ok) {
    if (wantsJson(req)) return jsonResponse(false, parsed.error);
    return NextResponse.redirect(new URL(`/?error=${parsed.error}`, req.url));
  }
  const { name, phone, email, dob, wedding, city } = parsed.fields;

  try {
    await initDb();
    const db = getDb();
    const existingRows = await queryCustomers(
      db,
      "SELECT phone, active FROM customers WHERE phone = $1",
      [phone]
    );
    const existing = existingRows[0];

    if (existing) {
      const isActive = existing.active === true || existing.active === 1;
      if (isActive) {
        if (wantsJson(req)) return jsonResponse(false, "already_registered");
        return NextResponse.redirect(new URL("/?error=already_registered", req.url));
      }
    }

    const insertSql =
      db.type === "postgres"
        ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT(phone) DO UPDATE SET active = TRUE, unsubscribed_at = NULL, name = EXCLUDED.name, email = EXCLUDED.email,
           date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city`
        : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT(phone) DO UPDATE SET active = 1, unsubscribed_at = NULL, name = excluded.name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city`;
    await runDb(db, insertSql, [phone, name, email, dob, wedding, city]);

    if (db.type === "sqlite") db.conn.close();
    if (wantsJson(req)) return jsonResponse(true);
    return NextResponse.redirect(new URL("/?success=1", req.url));
  } catch (e) {
    console.error("Submit error:", e);
    if (wantsJson(req)) return jsonResponse(false, "system");
    return NextResponse.redirect(new URL("/?error=system", req.url));
  }
}
