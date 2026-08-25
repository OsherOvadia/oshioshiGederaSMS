"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// One column per reward type, in the order a waiter is most likely to need it.
const COLUMNS = [
  { type: "joining", label: "הצטרפות", full: "מתנת הצטרפות" },
  { type: "birthday", label: "יום הולדת", full: "מתנת יום הולדת" },
  { type: "anniversary", label: "יום נישואין", full: "מתנת יום נישואין" },
] as const;

// The list is filtered in the browser, so keep the DOM bounded on a tablet.
const RENDER_LIMIT = 150;
// Cap the load-in stagger so a long list doesn't animate for seconds.
const STAGGER_CAP = 14;

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
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
}

export default function WaiterTable({ customers }: { customers: WaiterCustomerView[] }) {
  const router = useRouter();
  const ids = useId();
  const searchId = `${ids}-search`;
  const metaId = `${ids}-meta`;
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
      const stored = c.phone.replace(/\D/g, "");
      return stored.includes(qDigits) || localPhone(c.phone).replace(/\D/g, "").includes(qDigits);
    });
  }, [customers, deferredQuery]);

  const shown = filtered.slice(0, RENDER_LIMIT);
  const hasQuery = deferredQuery.trim() !== "";
  const readyCount = useMemo(
    () => filtered.reduce((n, c) => n + c.gifts.filter((g) => g.status === "available").length, 0),
    [filtered]
  );

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
    if (ok) setFlash(`${gift.label} · ${customerName} — סומנה כמומשה`);
    if (message) setError(message);
    // Re-read from the server either way, so the screen always shows truth.
    router.refresh();
  }

  function Reward({ customer, type }: { customer: WaiterCustomerView; type: string }) {
    // Newest first: if a member somehow holds two gifts of one type, the
    // actionable one should be on top.
    const gifts = customer.gifts.filter((g) => g.type === type).sort((a, b) => b.id - a.id);
    if (gifts.length === 0) {
      // aria-label on a plain span is ignored by several screen readers; real
      // text in a visually-hidden span is not.
      return (
        <>
          <span className="rw-empty" aria-hidden="true">
            ·
          </span>
          <span className="sr-only">אין מתנה</span>
        </>
      );
    }
    return (
      <div className="rw-stack">
        {gifts.map((g) => {
          if (g.status === "available") {
            const validity = g.valid_until ? `בתוקף עד ${shortDate(g.valid_until)}` : "ללא הגבלת תוקף";
            return (
              <button
                key={g.id}
                type="button"
                className="rw-btn"
                disabled={busyGiftId !== null}
                onClick={() => redeem(customer.name, g)}
                title={validity}
              >
                <span className="rw-btn-label">{busyGiftId === g.id ? "רגע…" : "מימוש"}</span>
                {/* Without this every button on the screen is just "מימוש". */}
                <span className="sr-only">
                  {" "}
                  {g.label} של {customer.name || "לקוח ללא שם"} — {validity}
                </span>
                {g.valid_until && (
                  <span className="rw-btn-sub" aria-hidden="true">
                    עד {shortDate(g.valid_until)}
                  </span>
                )}
              </button>
            );
          }
          if (g.status === "not_yet") {
            return (
              <span key={g.id} className="rw-chip rw-chip-wait">
                <span className="sr-only">{g.label} — ניתן למימוש החל מ־</span>
                <span aria-hidden="true">מ־</span>
                {shortDate(g.valid_from)}
              </span>
            );
          }
          if (g.status === "expired") {
            return (
              <span key={g.id} className="rw-chip rw-chip-wait">
                <span className="sr-only">{g.label} — </span>פג תוקף
              </span>
            );
          }
          return (
            <span key={g.id} className="rw-chip rw-chip-used">
              <span className="sr-only">{g.label} — מומשה ב־</span>
              <span aria-hidden="true">✓ </span>
              {shortDate(g.redeemed_at)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="wt-search">
        <label className="sr-only" htmlFor={searchId}>
          חיפוש לקוח לפי שם או טלפון
        </label>
        <span className="wt-search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          id={searchId}
          type="search"
          placeholder="שם או טלפון…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby={metaId}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="wt-search-clear" onClick={() => setQuery("")} aria-label="נקה חיפוש">
            ✕
          </button>
        )}
      </div>

      {/* Announces the result count as the waiter types, so the search is
          usable without watching the list redraw. */}
      <div className="wt-meta" id={metaId} role="status" aria-live="polite">
        <span>
          <strong>{filtered.length}</strong> {hasQuery ? `מתוך ${customers.length}` : "לקוחות"}
        </span>
        <span className="wt-meta-dot" aria-hidden="true" />
        <span className={readyCount > 0 ? "wt-ready" : "wt-ready wt-ready-none"}>
          {readyCount > 0 ? `${readyCount} מתנות למימוש` : "אין מתנות למימוש"}
        </span>
      </div>

      {flash && (
        <p className="wt-flash" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="wt-error" role="alert">
          {error}
        </p>
      )}

      {/* Wide screens: one row per member, one column per reward */}
      <div className="wt-table-wrap" role="region" aria-label="מתנות לפי לקוח" tabIndex={0}>
        <table className="wt-table">
          <caption className="sr-only">
            לקוחות פעילים והמתנות שלהם — מתנת הצטרפות, יום הולדת ויום נישואין
          </caption>
          <thead>
            <tr>
              <th scope="col">לקוח</th>
              {COLUMNS.map((col) => (
                <th scope="col" key={col.type} className={`wt-th-${col.type}`}>
                  <span aria-hidden="true">{col.label}</span>
                  <span className="sr-only">{col.full}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={1 + COLUMNS.length} className="wt-empty">
                  {hasQuery ? "לא נמצא לקוח בשם או במספר הזה" : "אין לקוחות להצגה"}
                </td>
              </tr>
            )}
            {shown.map((c, i) => (
              <tr key={c.phone} style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * 35}ms` }}>
                <th scope="row" className="wt-who">
                  <span className="wt-name">{c.name || "—"}</span>
                  <a className="wt-phone" href={`tel:${c.phone}`}>
                    <span className="sr-only">חיוג ל־</span>
                    <bdi>{localPhone(c.phone)}</bdi>
                  </a>
                </th>
                {COLUMNS.map((col) => (
                  <td key={col.type} className={`rw-${col.type}`}>
                    <Reward customer={c} type={col.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: a card per member — never a sideways scroll */}
      <div className="wt-cards">
        {shown.length === 0 && (
          <p className="wt-empty">{hasQuery ? "לא נמצא לקוח בשם או במספר הזה" : "אין לקוחות להצגה"}</p>
        )}
        {shown.map((c, i) => (
          <article key={c.phone} className="wt-card" style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * 35}ms` }}>
            <header className="wt-card-head">
              <h2 className="wt-name">{c.name || "—"}</h2>
              <a className="wt-phone" href={`tel:${c.phone}`}>
                <span className="sr-only">חיוג ל־</span>
                <bdi>{localPhone(c.phone)}</bdi>
              </a>
            </header>
            <dl className="wt-card-rewards">
              {COLUMNS.map((col) => (
                <div key={col.type} className={`wt-card-row rw-${col.type}`}>
                  <dt>{col.full}</dt>
                  <dd>
                    <Reward customer={c} type={col.type} />
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
