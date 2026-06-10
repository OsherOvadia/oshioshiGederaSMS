import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { createImportToken } from "@/lib/security";
import { getDb, queryCustomers, mapRow, initDb, type CustomerRow } from "@/lib/db";
import { israelToday, toIsraelDateStr } from "@/lib/dates";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import ResetDbForm from "./ResetDbForm";

const AdminStats = nextDynamic(() => import("./AdminStats"), { ssr: true, loading: () => <div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>טוען סטטיסטיקות...</div> });

export const dynamic = "force-dynamic";

function formatRegDate(created: string | null): string {
  if (!created) return "-";
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return created.trim().split(" ")[0] || "-";
  return d.toISOString().slice(0, 10);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; filter?: string }>;
}) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  let importToken = "";
  try {
    importToken = createImportToken();
  } catch {
    importToken = "";
  }

  let customers: Awaited<ReturnType<typeof mapRow>>[] = [];
  try {
    await initDb();
    const db = getDb();
    const rows = await queryCustomers(
      db,
      "SELECT phone, name, email, date_of_birth, wedding_day, city, active, created_at, received_message_at, unsubscribed_at FROM customers ORDER BY active DESC, name ASC",
      []
    );
    if (db.type === "sqlite") db.conn.close();
    customers = rows.map(mapRow);
  } catch (e) {
    console.error("Admin page DB error:", e);
    redirect("/login?error=system");
  }

  let activeCount = 0;
  let newCount = 0;
  const byDate: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const c of customers) {
    if (c.active) {
      activeCount++;
      if (!c.received_message_at) newCount++;
    }
    const d = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : "";
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
    const city = (c.city ?? "").trim() || "ללא עיר";
    byCity[city] = (byCity[city] ?? 0) + 1;
  }
  const signupsByDate = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cityCounts = Object.entries(byCity)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const params = await searchParams;
  const msg = params.msg ?? "";

  // Daily filters (Israel local day). "Signed up today" = created today;
  // "removed today" = currently inactive and unsubscribed/blocked today.
  const today = israelToday();
  const isSignupToday = (c: CustomerRow) => toIsraelDateStr(c.created_at) === today;
  const isRemovedToday = (c: CustomerRow) => !c.active && toIsraelDateStr(c.unsubscribed_at) === today;
  const signupTodayCount = customers.filter(isSignupToday).length;
  const removedTodayCount = customers.filter(isRemovedToday).length;

  const filter = params.filter === "signup_today" || params.filter === "unsub_today" ? params.filter : "";
  const displayed =
    filter === "signup_today"
      ? customers.filter(isSignupToday)
      : filter === "unsub_today"
        ? customers.filter(isRemovedToday)
        : customers;

  return (
    <div className="container admin-container" style={{ maxWidth: "900px" }}>
      <div style={{ direction: "rtl", textAlign: "right" }}>
        <div className="admin-header">
          <h2 className="admin-title">ניהול לקוחות 🍣</h2>
          <div className="admin-actions">
            <Link
              href="/api/admin/export-csv"
              className="admin-btn admin-btn-green"
              target="_blank"
              rel="noopener noreferrer"
            >
              📊 ייצוא CSV
            </Link>
            <ResetDbForm importToken={importToken} />
            <Link href="/api/logout" className="admin-btn admin-btn-logout">
              יציאה
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 style={{ marginTop: 0 }}>📢 שליחת הודעה ({activeCount} פעילים)</h3>
          <BroadcastForm importToken={importToken} activeCount={activeCount} newCount={newCount} />
          {msg && <p style={{ color: "blue", fontWeight: "bold", marginTop: "10px" }}>{msg}</p>}
          <UploadForm importToken={importToken} />
        </div>

        <AdminStats signupsByDate={signupsByDate} cityCounts={cityCounts} />

        <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "15px" }}>
          רשימת לקוחות ({displayed.length})
        </h3>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "15px" }}>
          {[
            { key: "", label: `הכל (${customers.length})`, href: "/admin" },
            { key: "signup_today", label: `נרשמו היום (${signupTodayCount})`, href: "/admin?filter=signup_today" },
            { key: "unsub_today", label: `הוסרו היום (${removedTodayCount})`, href: "/admin?filter=unsub_today" },
          ].map((f) => {
            const active = filter === f.key;
            return (
              <Link
                key={f.key || "all"}
                href={f.href}
                style={{
                  padding: "6px 14px",
                  borderRadius: "20px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                  border: "1px solid #d32f2f",
                  background: active ? "#d32f2f" : "#fff",
                  color: active ? "#fff" : "#d32f2f",
                }}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead style={{ background: "#f5f5f5", position: "sticky", top: 0 }}>
              <tr style={{ borderBottom: "2px solid #d32f2f" }}>
                <th style={{ padding: "10px", textAlign: "right" }}>שם</th>
                <th style={{ padding: "10px", textAlign: "right" }}>דוא&quot;ל</th>
                <th style={{ padding: "10px", textAlign: "right" }}>טלפון</th>
                <th style={{ padding: "10px", textAlign: "center" }}>תאריך לידה</th>
                <th style={{ padding: "10px", textAlign: "center" }}>יום חתונה</th>
                <th style={{ padding: "10px", textAlign: "right" }}>עיר</th>
                <th style={{ padding: "10px", textAlign: "center" }}>תאריך רישום</th>
                <th style={{ padding: "10px", textAlign: "center" }}>סטטוס</th>
                <th style={{ padding: "10px", textAlign: "center" }}>חדש</th>
                <th style={{ padding: "10px", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: "20px", textAlign: "center", color: "#666" }}>
                    אין תוצאות
                  </td>
                </tr>
              )}
              {displayed.map((c) => (
                <tr key={c.phone} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "10px", textAlign: "right" }}>{c.name}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.email || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px", direction: "ltr" }}>{c.phone}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.date_of_birth || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.wedding_day || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.city || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{formatRegDate(c.created_at)}</td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    {c.active ? <span className="success">פעיל</span> : <span className="error">הוסר</span>}
                  </td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    {!c.received_message_at ? (
                      <span style={{ background: "#e3f2fd", color: "#1565c0", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: 600 }}>חדש</span>
                    ) : (
                      <span style={{ color: "#999", fontSize: "12px" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    {c.active ? (
                      <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
                        <input type="hidden" name="import_token" value={importToken} />
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="block" />
                        <button type="submit" className="admin-table-btn">⛔ חסימה</button>
                      </form>
                    ) : (
                      <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
                        <input type="hidden" name="import_token" value={importToken} />
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="unblock" />
                        <button type="submit" className="admin-table-btn">✅ שחזור</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
