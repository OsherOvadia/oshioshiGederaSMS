"use client";

import { useState } from "react";

type Gift = {
  id: number;
  type: string;
  label: string;
  status: "available" | "not_yet" | "used" | "expired";
  valid_from: string;
  valid_until: string | null;
  redeemed_at: string | null;
};
type Customer = { phone: string; name: string; gifts: Gift[] };

function statusText(g: Gift): string {
  switch (g.status) {
    case "available":
      return g.valid_until ? `זמינה למימוש עד ${g.valid_until}` : "זמינה למימוש";
    case "not_yet":
      return `זמינה החל מ-${g.valid_from}`;
    case "used":
      return `מומשה ב-${(g.redeemed_at ?? "").slice(0, 10)}`;
    case "expired":
      return "פג תוקף";
  }
}

export default function WaiterPanel() {
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/waiter/customers?q=${encodeURIComponent(query)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch {
      setError("שגיאה בחיפוש. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  async function redeem(gift: Gift) {
    if (!window.confirm(`לאשר מימוש "${gift.label}"? פעולה זו אינה ניתנת לביטול.`)) return;
    setError(null);
    try {
      const res = await fetch("/api/waiter/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ giftId: gift.id }),
      });
      if (res.status === 409) {
        setError("המתנה כבר מומשה או אינה בתוקף.");
      } else if (!res.ok) {
        setError("שגיאה במימוש. נסו שוב.");
      }
    } catch {
      setError("שגיאה במימוש. נסו שוב.");
    }
    await search(q); // always refresh so the screen shows the true state
  }

  return (
    <div className="waiter-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) search(q.trim());
        }}
      >
        <div className="form-group">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם או מספר טלפון (לפחות 2 תווים)"
            aria-label="חיפוש לקוח"
          />
        </div>
        <button type="submit" disabled={loading || q.trim().length < 2}>
          {loading ? "מחפש..." : "חיפוש"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {customers.map((c) => (
        <div key={c.phone} className="waiter-customer">
          <div className="waiter-customer-head">
            <strong>{c.name}</strong>
            <span dir="ltr">{c.phone}</span>
          </div>
          {c.gifts.length === 0 ? (
            <p className="waiter-no-gifts">אין מתנות ללקוח זה.</p>
          ) : (
            <ul className="waiter-gifts">
              {c.gifts.map((g) => (
                <li key={g.id} className={`waiter-gift status-${g.status}`}>
                  <span className="gift-label">{g.label}</span>
                  <span className="gift-status">{statusText(g)}</span>
                  {g.status === "available" && (
                    <button type="button" className="redeem-btn" onClick={() => redeem(g)}>
                      סימון כמומשה
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
