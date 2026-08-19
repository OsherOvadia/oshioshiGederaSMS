import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionRole } from "@/lib/auth";
import { getDb, initDb } from "@/lib/db";
import { listActiveCustomersWithGifts } from "@/lib/gifts";
import WaiterTable from "./WaiterTable";

export const dynamic = "force-dynamic";

export default async function WaiterPage() {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") redirect("/login");

  // Loaded server-side so the table is populated on first paint and searching
  // is a pure in-browser filter — no request per keystroke.
  let customers: Awaited<ReturnType<typeof listActiveCustomersWithGifts>> = [];
  let loadError = false;
  try {
    await initDb();
    const db = getDb();
    customers = await listActiveCustomersWithGifts(db);
    if (db.type === "sqlite") db.conn.close();
  } catch (e) {
    console.error("Waiter page load error:", e);
    loadError = true;
  }

  return (
    <main className="container waiter-page">
      <div className="admin-header">
        <h1 className="admin-title">מסך מלצרים 🍣</h1>
        <div className="admin-actions">
          <Link href="/api/logout" className="admin-btn admin-btn-logout">
            יציאה
          </Link>
        </div>
      </div>
      <p className="waiter-sub">חיפוש לקוח לפי שם או טלפון, וסימון מתנות שמומשו.</p>
      {loadError ? (
        <p className="error" role="alert">
          שגיאה בטעינת רשימת הלקוחות. רעננו את הדף ונסו שוב.
        </p>
      ) : (
        <WaiterTable customers={customers} />
      )}
    </main>
  );
}
