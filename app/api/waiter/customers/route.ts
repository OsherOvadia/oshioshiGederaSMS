import { NextRequest, NextResponse } from "next/server";
import { getSessionRole } from "@/lib/auth";
import { getDb, initDb } from "@/lib/db";
import { searchCustomersWithGifts } from "@/lib/gifts";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function GET(req: NextRequest) {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "waiter", LIMITS.waiter.max);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  try {
    await initDb();
    const db = getDb();
    // searchCustomersWithGifts returns ONLY phone + name + gifts — the waiter
    // must never see email/birthday/city, enforced at the SQL level.
    const customers = await searchCustomersWithGifts(db, q);
    if (db.type === "sqlite") db.conn.close();
    return NextResponse.json({ customers });
  } catch (e) {
    console.error("Waiter search error:", e);
    return NextResponse.json({ error: "system" }, { status: 500 });
  }
}
