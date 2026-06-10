"use client";

import { useMemo, useState } from "react";
import {
  smsUnits,
  segmentsForUnits,
  estimateUnsubFooterUnits,
} from "@/lib/sms-segments";

type Props = { importToken: string; activeCount: number; newCount: number };

export default function BroadcastForm({ importToken, activeCount, newCount }: Props) {
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "new_only">("all");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);

  const footerUnits = useMemo(() => estimateUnsubFooterUnits(), []);
  const units = smsUnits(message);
  const totalUnits = units === 0 ? 0 : units + footerUnits;
  const totalSegments = segmentsForUnits(totalUnits);
  const recipients = audience === "all" ? activeCount : newCount;
  const level = totalSegments >= 4 ? "high" : totalSegments >= 3 ? "warn" : "ok";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const confirmMsg =
      audience === "new_only"
        ? `לשלוח רק ל-${newCount} לקוחות חדשים (שטרם קיבלו הודעה)?\n~${totalSegments} מקטעי SMS לנמען, ~${newCount * totalSegments} הודעות בסך הכל.`
        : `לשלוח לכולם (${activeCount} פעילים)?\n~${totalSegments} מקטעי SMS לנמען, ~${activeCount * totalSegments} הודעות בסך הכל.`;
    if (!confirm(confirmMsg)) return;

    setFeedback(null);
    setSending(true);
    const formData = new FormData();
    formData.set("message", message);
    formData.set("send_to", audience);
    formData.set("import_token", importToken);

    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (data.msg != null) {
        setFeedback({ ok: data.ok === true, msg: data.msg });
        if (data.ok === true) setMessage("");
      } else {
        setFeedback({ ok: false, msg: res.ok ? "תגובה לא צפויה מהשרת." : `שגיאה ${res.status}` });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setSending(false);
    }
  }

  function handleTestSend() {
    const phone = window.prompt("מספר טלפון לבדיקה (למשל 0501234567):");
    if (!phone) return;
    // Plain form POST so the existing 303-redirect-with-?msg= flow shows the result.
    const f = document.createElement("form");
    f.method = "POST";
    f.action = "/api/admin/send-test";
    const add = (name: string, value: string) => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = name;
      i.value = value;
      f.appendChild(i);
    };
    add("import_token", importToken);
    add("phone", phone);
    add("message", message);
    document.body.appendChild(f);
    f.submit();
  }

  return (
    <>
      {feedback && (
        <p
          style={{
            marginBottom: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontWeight: "bold",
            backgroundColor: feedback.ok ? "#e8f5e9" : "#ffebee",
            color: feedback.ok ? "#2e7d32" : "#c62828",
          }}
          role="status"
        >
          {feedback.msg}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <textarea
          name="message"
          placeholder="הקלידו הודעה כאן..."
          required
          disabled={sending}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ height: "100px" }}
          aria-describedby="sms-counter"
        />
        <div id="sms-counter" className="sms-counter" data-level={level}>
          <span>{units} תווים</span>
          <span>
            כולל קישור הסרה: ~{totalUnits} תווים · ~{totalSegments} מקטעי SMS לנמען
          </span>
        </div>
        <fieldset className="audience-group" style={{ border: "none" }}>
          <label>
            <input
              type="radio"
              name="audience"
              checked={audience === "all"}
              onChange={() => setAudience("all")}
              disabled={sending}
            />
            כל הפעילים ({activeCount})
          </label>
          <label>
            <input
              type="radio"
              name="audience"
              checked={audience === "new_only"}
              onChange={() => setAudience("new_only")}
              disabled={sending || newCount === 0}
            />
            רק חדשים שטרם קיבלו הודעה ({newCount})
          </label>
        </fieldset>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <button
            type="submit"
            disabled={sending || message.trim() === "" || recipients === 0}
            style={{ width: "auto", flex: "1 1 auto" }}
          >
            {sending ? "שולח..." : `🚀 שלח ל-${recipients} לקוחות`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleTestSend}
            disabled={sending || message.trim() === ""}
            style={{ width: "auto" }}
          >
            📱 שלח בדיקה אליי
          </button>
        </div>
      </form>
    </>
  );
}
