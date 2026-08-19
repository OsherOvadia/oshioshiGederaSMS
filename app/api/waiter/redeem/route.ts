import { NextRequest, NextResponse } from "next/server";
import { getSessionRole } from "@/lib/auth";
import { getDb, initDb } from "@/lib/db";
import { redeemGift } from "@/lib/gifts";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "waiter", LIMITS.waiter.max);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let giftId: unknown;
  try {
    const body = await req.json();
    giftId = (body as { giftId?: unknown }).giftId;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  if (typeof giftId !== "number" || !Number.isInteger(giftId) || giftId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const id = giftId;

  try {
    await initDb();
    const db = getDb();
    const redeemed = await redeemGift(db, id, role);
    if (db.type === "sqlite") db.conn.close();
    if (!redeemed) {
      // Already used, outside its validity window, or customer inactive.
      return NextResponse.json({ ok: false, error: "unavailable" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Waiter redeem error:", e);
    return NextResponse.json({ ok: false, error: "system" }, { status: 500 });
  }
}
