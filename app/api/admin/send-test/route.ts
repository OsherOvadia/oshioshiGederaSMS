import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken, generateSecureToken } from "@/lib/security";
import { getPublicAppUrl } from "@/lib/app-url";
import { formatPhone, isValidPhone } from "@/lib/validation";
import { initDb, getDb, runDb } from "@/lib/db";
import { isRealSmsConfigured, sendSms } from "@/lib/sms";

async function redirectAdmin(req: NextRequest, msg: string, sessionOk: boolean) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  if (sessionOk) await attachSessionCookie(res, "admin");
  return res;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((form.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);

  const rawPhone = ((form.get("phone") as string) ?? "").trim();
  const message = ((form.get("message") as string) ?? "").trim();

  if (!message || message.length > 1000) {
    return redirectAdmin(req, "הודעת הבדיקה חייבת להכיל עד 1000 תווים.", sessionOk);
  }

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) {
    return redirectAdmin(req, "מספר טלפון לא תקין. נא להזין מספר מלא (למשל 0501234567 או +972501234567).", sessionOk);
  }

  if (!isRealSmsConfigured()) {
    return redirectAdmin(req, "שגיאה: חסר הגדרת שער SMS.", sessionOk);
  }

  const token = generateSecureToken(phone);
  const clean = phone.replace("+", "");
  const baseUrl = getPublicAppUrl() || req.nextUrl.origin;
  const unsubLink = `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${clean}?token=${token}`;
  const finalMsg = `${message}\n\nלהסרה: ${unsubLink}`;

  try {
    const result = await sendSms(phone, finalMsg);
    if (!result.ok) {
      console.error("SMS send error (test)", result.status ?? "", result.error);
      return redirectAdmin(req, "שליחת הודעת הבדיקה נכשלה: " + (result.error || result.status), sessionOk);
    }
    try {
      await initDb();
      const db = getDb();
      const now = new Date().toISOString();
      await runDb(db, "UPDATE customers SET received_message_at = $2 WHERE phone = $1", [phone, now]);
      if (db.type === "sqlite") db.conn.close();
    } catch (e) {
      console.error("Failed to set received_message_at (test)", phone, e);
    }
    return redirectAdmin(req, `הודעת בדיקה נשלחה ל־${phone}.`, sessionOk);
  } catch (e) {
    console.error("Send test SMS error:", e);
    return redirectAdmin(req, "שגיאה בשליחת הודעת הבדיקה.", sessionOk);
  }
}
