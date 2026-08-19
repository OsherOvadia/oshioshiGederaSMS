import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { applySchema, getDb, runDb } from "@/lib/db";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function GET() {
  const ok = await getAdminSession();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = await getClientIp();
  const { ok: rateOk } = await checkRateLimit(ip, "force-init", LIMITS.forceInit.max);
  if (!rateOk) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const db = getDb();
    if (db.type === "postgres") {
      await runDb(db, "DROP TABLE IF EXISTS customers CASCADE", []);
      await applySchema(db);
    } else {
      await runDb(db, "DROP TABLE IF EXISTS customers", []);
      await applySchema(db);
      db.conn.close();
    }
    return new NextResponse("✅ Table 'customers' created successfully!");
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
