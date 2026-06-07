import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { getDb, runDb } from "@/lib/db";
import { normalizeAdminPhone } from "@/lib/validation";

async function redirectAdmin(req: NextRequest, msg?: string) {
  const url = new URL("/admin", req.url);
  if (msg) url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  await attachSessionCookie(res);
  return res;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((formData.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.");
  }

  const phone = ((formData.get("phone") as string) ?? "").trim();
  const action = ((formData.get("action") as string) ?? "").trim();
  if (!phone || !["block", "unblock"].includes(action)) {
    return redirectAdmin(req);
  }

  const { formatted, clean } = normalizeAdminPhone(phone);

  const db = getDb();
  const activeVal = action === "unblock";
  const setVal = db.type === "postgres" ? activeVal : activeVal ? 1 : 0;

  const { rowCount } = await runDb(
    db,
    "UPDATE customers SET active = $2 WHERE phone = $1",
    [formatted, setVal]
  );
  if (rowCount === 0 && clean) {
    await runDb(db, "UPDATE customers SET active = $2 WHERE phone LIKE $1", [`%${clean}`, setVal]);
  }
  if (activeVal) {
    await runDb(db, "UPDATE customers SET received_message_at = NULL WHERE phone = $1", [formatted]);
    if (rowCount === 0 && clean) {
      await runDb(db, "UPDATE customers SET received_message_at = NULL WHERE phone LIKE $1", [`%${clean}`]);
    }
  }
  if (db.type === "sqlite") db.conn.close();

  return redirectAdmin(req);
}
