import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { createImportToken } from "@/lib/security";
import { getDb, queryCustomers, mapRow, initDb, type CustomerRow } from "@/lib/db";
import { israelToday, toIsraelDateStr } from "@/lib/dates";
import { computeKpis } from "@/lib/kpis";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import ResetDbForm from "./ResetDbForm";
import CustomerTable, { type CustomerView } from "./CustomerTable";

const AdminStats = nextDynamic(() => import("./AdminStats"), {
  ssr: true,
  loading: () => (
    <div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
      טוען סטטיסטיקות...
    </div>
  ),
});

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

  let customers: CustomerRow[] = [];
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

  const today = israelToday();
  const kpis = computeKpis(customers, today);

  const byDate: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const c of customers) {
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

  const customerViews: CustomerView[] = displayed.map((c) => ({
    phone: c.phone,
    name: c.name,
    email: c.email,
    date_of_birth: c.date_of_birth,
    wedding_day: c.wedding_day,
    city: c.city,
    active: c.active,
    regDate: formatRegDate(c.created_at),
    isNew: c.active && !c.received_message_at,
  }));

  return (
    <div className="container admin-container">
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
            <Link href="/api/logout" className="admin-btn admin-btn-logout">
              יציאה
            </Link>
          </div>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-value">{kpis.active}</div>
            <div className="kpi-label">לקוחות פעילים</div>
            <div className="kpi-sub">מתוך {kpis.total} רשומים</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.newLast7}</div>
            <div className="kpi-label">חדשים ב-7 ימים</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.removedLast30}</div>
            <div className="kpi-label">הוסרו ב-30 יום</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpis.neverMessaged}</div>
            <div className="kpi-label">טרם קיבלו הודעה</div>
          </div>
        </div>

        <div className="admin-card">
          <h3 style={{ marginTop: 0 }}>📢 שליחת הודעה</h3>
          <BroadcastForm importToken={importToken} activeCount={kpis.active} newCount={kpis.neverMessaged} />
          {msg && <p style={{ color: "#1565c0", fontWeight: "bold", marginTop: "10px" }}>{msg}</p>}
        </div>

        <div className="admin-card">
          <UploadForm importToken={importToken} />
        </div>

        <AdminStats signupsByDate={signupsByDate} cityCounts={cityCounts} />

        <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "15px" }}>
          רשימת לקוחות ({displayed.length})
        </h3>

        <div className="filter-chips">
          {[
            { key: "", label: `הכל (${customers.length})`, href: "/admin" },
            { key: "signup_today", label: `נרשמו היום (${signupTodayCount})`, href: "/admin?filter=signup_today" },
            { key: "unsub_today", label: `הוסרו היום (${removedTodayCount})`, href: "/admin?filter=unsub_today" },
          ].map((f) => (
            <Link key={f.key || "all"} href={f.href} className="filter-chip" data-active={filter === f.key}>
              {f.label}
            </Link>
          ))}
        </div>

        <CustomerTable customers={customerViews} importToken={importToken} />

        <div className="danger-zone">
          <h3>אזור מסוכן</h3>
          <p style={{ fontSize: "13px" }}>פעולות בלתי הפיכות. להשתמש בזהירות.</p>
          <ResetDbForm importToken={importToken} />
        </div>
      </div>
    </div>
  );
}
