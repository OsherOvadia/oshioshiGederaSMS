"use client";

import { useMemo, useState } from "react";

export type CustomerView = {
  phone: string;
  name: string;
  email: string;
  date_of_birth: string;
  wedding_day: string;
  city: string;
  active: boolean;
  regDate: string; // pre-formatted YYYY-MM-DD or "-"
  isNew: boolean; // active and never messaged
};

type Props = { customers: CustomerView[]; importToken: string };

function ToggleForm({ phone, active, importToken }: { phone: string; active: boolean; importToken: string }) {
  return (
    <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
      <input type="hidden" name="import_token" value={importToken} />
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="action" value={active ? "block" : "unblock"} />
      <button type="submit" className="admin-table-btn">
        {active ? "⛔ חסימה" : "✅ שחזור"}
      </button>
    </form>
  );
}

function StatusBadges({ c }: { c: CustomerView }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px" }}>
      {c.active ? <span className="badge badge-active">פעיל</span> : <span className="badge badge-removed">הוסר</span>}
      {c.isNew && <span className="badge badge-new">חדש</span>}
    </span>
  );
}

export default function CustomerTable({ customers, importToken }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    const qDigits = q.replace(/\D/g, "");
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (qDigits !== "" && c.phone.replace(/\D/g, "").includes(qDigits))
    );
  }, [customers, query]);

  return (
    <>
      <input
        type="search"
        className="table-search"
        placeholder="חיפוש לפי שם, טלפון, עיר או דוא&quot;ל..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="חיפוש לקוחות"
      />
      {query && (
        <p style={{ fontSize: "13px", margin: "0 0 10px" }}>
          {filtered.length} תוצאות מתוך {customers.length}
        </p>
      )}

      {/* Desktop: full table */}
      <div className="customers-desktop admin-table-wrap">
        <table className="admin-table">
          <thead style={{ background: "#f5f5f5" }}>
            <tr style={{ borderBottom: "2px solid #d32f2f" }}>
              <th style={{ padding: "10px", textAlign: "right" }}>שם</th>
              <th style={{ padding: "10px", textAlign: "right" }}>דוא&quot;ל</th>
              <th style={{ padding: "10px", textAlign: "right" }}>טלפון</th>
              <th style={{ padding: "10px", textAlign: "center" }}>תאריך לידה</th>
              <th style={{ padding: "10px", textAlign: "center" }}>יום נישואין</th>
              <th style={{ padding: "10px", textAlign: "right" }}>עיר</th>
              <th style={{ padding: "10px", textAlign: "center" }}>תאריך רישום</th>
              <th style={{ padding: "10px", textAlign: "center" }}>סטטוס</th>
              <th style={{ padding: "10px", textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "20px", textAlign: "center", color: "#666" }}>
                  אין תוצאות
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.phone} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px", textAlign: "right" }}>{c.name}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.email || "-"}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px", direction: "ltr" }}>{c.phone}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.date_of_birth || "-"}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.wedding_day || "-"}</td>
                <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.city || "-"}</td>
                <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.regDate}</td>
                <td style={{ padding: "10px", textAlign: "center" }}>
                  <StatusBadges c={c} />
                </td>
                <td style={{ padding: "10px", textAlign: "center" }}>
                  <ToggleForm phone={c.phone} active={c.active} importToken={importToken} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards with progressive disclosure */}
      <div className="customers-mobile">
        {filtered.length === 0 && <p style={{ textAlign: "center" }}>אין תוצאות</p>}
        {filtered.map((c) => (
          <div key={c.phone} className="customer-card">
            <div className="customer-card-head">
              <span className="customer-card-name">{c.name}</span>
              <StatusBadges c={c} />
            </div>
            <p className="customer-card-line">
              <a href={`tel:${c.phone}`} style={{ direction: "ltr", unicodeBidi: "embed" }}>
                {c.phone}
              </a>
              {c.city ? ` · ${c.city}` : ""}
            </p>
            <p className="customer-card-line">נרשם/ה {c.regDate}</p>
            <details>
              <summary>פרטים נוספים</summary>
              <p className="customer-card-line">דוא&quot;ל: {c.email || "-"}</p>
              <p className="customer-card-line">תאריך לידה: {c.date_of_birth || "-"}</p>
              <p className="customer-card-line">יום נישואין: {c.wedding_day || "-"}</p>
            </details>
            <div style={{ marginTop: "6px" }}>
              <ToggleForm phone={c.phone} active={c.active} importToken={importToken} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
