"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// One column per reward type, in the order a waiter is most likely to need it.
const COLUMNS = [
  { type: "joining", label: "מתנת הצטרפות" },
  { type: "birthday", label: "מתנת יום הולדת" },
  { type: "anniversary", label: "מתנת יום נישואין" },
] as const;

// The list is filtered in the browser, so keep the DOM bounded on a tablet.
const RENDER_LIMIT = 150;

export type WaiterGiftView = {
  id: number;
  type: string;
  label: string;
  status: "available" | "not_yet" | "used" | "expired";
  valid_from: string;
  valid_until: string | null;
  redeemed_at: string | null;
};

export type WaiterCustomerView = { phone: string; name: string; gifts: WaiterGiftView[] };

/** Local (Israeli) display form: +972501234567 -> 050-1234567 */
function localPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("972") ? "0" + d.slice(3) : d;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}` : iso;
}

export default function WaiterTable({ customers }: { customers: WaiterCustomerView[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [busyGiftId, setBusyGiftId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return customers;
    // A waiter types either a name or digits — match both, and match digits
    // against the local 05x form as well as the stored +972 form.
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (!qDigits) return false;
      const phoneDigits = c.phone.replace(/\D/g, "");
      return phoneDigits.includes(qDigits) || localPhone(c.phone).replace(/\D/g, "").includes(qDigits);
    });
  }, [customers, deferredQuery]);

  const shown = filtered.slice(0, RENDER_LIMIT);
  const hasQuery = deferredQuery.trim() !== "";

  async function redeem(customerName: string, gift: WaiterGiftView) {
    if (!window.confirm(`לאשר מימוש "${gift.label}" עבור ${customerName}? פעולה זו אינה ניתנת לביטול.`)) return;
    setError(null);
    setFlash(null);
    setBusyGiftId(gift.id);
    let message: string | null = null;
    let ok = false;
    try {
      const res = await fetch("/api/waiter/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ giftId: gift.id }),
      });
      if (res.ok) {
        ok = true;
      } else if (res.status === 409) {
        message = "המתנה כבר מומשה או אינה בתוקף.";
      } else if (res.status === 401) {
        message = "פג תוקף החיבור. יש להתחבר מחדש.";
      } else {
        // Surface the status — a generic message makes real faults undiagnosable.
        message = `שגיאה במימוש (${res.status}). נסו שוב.`;
      }
    } catch {
      message = "אין חיבור לרשת. בדקו את החיבור ונסו שוב.";
    } finally {
      setBusyGiftId(null);
    }
    if (ok) setFlash(`${gift.label} של ${customerName} סומנה כמומשה ✓`);
    if (message) setError(message);
    // Re-read from the server either way, so the table always shows truth.
    router.refresh();
  }

  function GiftCell({ customer, type }: { customer: WaiterCustomerView; type: string }) {
    // Newest first: if a member somehow holds two gifts of one type, the
    // actionable one should be on top.
    const gifts = customer.gifts.filter((g) => g.type === type).sort((a, b) => b.id - a.id);
    if (gifts.length === 0) return <span className="gift-none">—</span>;
    return (
      <>
        {gifts.map((g) => (
          <div key={g.id} className={`gift-cell status-${g.status}`}>
            {g.status === "available" && (
              <button
                type="button"
                className="redeem-btn"
                disabled={busyGiftId !== null}
                onClick={() => redeem(customer.name, g)}
              >
                {busyGiftId === g.id ? "רגע..." : "סמן כמומשה"}
              </button>
            )}
            {g.status === "not_yet" && <span className="gift-note">זמינה מ-{shortDate(g.valid_from)}</span>}
            {g.status === "used" && <span className="gift-note gift-used">מומשה {shortDate(g.redeemed_at)}</span>}
            {g.status === "available" && g.valid_until && (
              <span className="gift-note">עד {shortDate(g.valid_until)}</span>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <input
        type="search"
        className="table-search waiter-search"
        placeholder="חיפוש לפי שם או טלפון..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="חיפוש לקוח לפי שם או טלפון"
        autoComplete="off"
      />
      <p className="waiter-count">
        {hasQuery ? `${filtered.length} תוצאות מתוך ${customers.length}` : `${customers.length} לקוחות`}
        {filtered.length > RENDER_LIMIT && ` · מציג ${RENDER_LIMIT} ראשונים — חפשו כדי לצמצם`}
      </p>
      {flash && <p className="waiter-flash" role="status">{flash}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table waiter-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              {COLUMNS.map((col) => (
                <th key={col.type}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={2 + COLUMNS.length} className="waiter-empty">
                  {hasQuery ? "אין תוצאות" : "אין לקוחות להצגה"}
                </td>
              </tr>
            )}
            {shown.map((c) => (
              <tr key={c.phone}>
                <td className="waiter-name">{c.name || "—"}</td>
                <td className="waiter-phone">
                  <a href={`tel:${c.phone}`}>{localPhone(c.phone)}</a>
                </td>
                {COLUMNS.map((col) => (
                  <td key={col.type} className="waiter-gift-col">
                    <GiftCell customer={c} type={col.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
