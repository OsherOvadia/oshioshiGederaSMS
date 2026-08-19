import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import WaiterPanel from "./WaiterPanel";

export const dynamic = "force-dynamic";

export default async function WaiterPage() {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") redirect("/login");
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
      <WaiterPanel />
    </main>
  );
}
