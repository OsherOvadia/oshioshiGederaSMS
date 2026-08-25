import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { withDb, queryCustomers, runDb } from "@/lib/db";
import { normalizeAdminPhone } from "@/lib/validation";

async function redirectAdmin(req: NextRequest, msg: string | undefined, sessionOk: boolean) {
  const url = new URL("/admin", req.url);
  if (msg) url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  // Only refresh the admin cookie for callers that already hold a valid admin
  // session — never on rejected or token-authenticated requests.
  if (sessionOk) await attachSessionCookie(res, "admin");
  return res;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => new FormData());
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((formData.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);
  }

  const phone = ((formData.get("phone") as string) ?? "").trim();
  if (!phone) return redirectAdmin(req, undefined, sessionOk);

  const { formatted, clean } = normalizeAdminPhone(phone);

  try {
    const msg = await withDb(async (db) => {
      // Resolve the stored phone before deleting. /toggle can apply its LIKE
      // fallback (older rows were saved in mixed formats) straight to the
      // UPDATE because a wrong extra match is reversible; a DELETE is not, so
      // here the fallback only ever identifies the row, and we refuse when it
      // is ambiguous.
      let rows = await queryCustomers(db, "SELECT phone FROM customers WHERE phone = $1", [formatted]);
      if (rows.length === 0 && clean) {
        rows = await queryCustomers(db, "SELECT phone FROM customers WHERE phone LIKE $1", [`%${clean}`]);
      }
      if (rows.length === 0) return "הלקוח לא נמצא במאגר.";
      if (rows.length > 1) return "נמצאו כמה רשומות תואמות — המחיקה בוטלה.";

      const target = String(rows[0].phone);
      // Gifts are linked by phone with no FK, so they must be removed
      // explicitly or they would outlive the customer. Tolerate a missing
      // gifts table (databases created before the gifts feature).
      await runDb(db, "DELETE FROM gifts WHERE phone = $1", [target]).catch(() => {});
      await runDb(db, "DELETE FROM customers WHERE phone = $1", [target]);
      return "הלקוח נמחק לצמיתות.";
    });
    return redirectAdmin(req, msg, sessionOk);
  } catch (e) {
    console.error("Delete customer error:", e);
    return redirectAdmin(req, "שגיאה במחיקת הלקוח.", sessionOk);
  }
}
