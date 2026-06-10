"use client";

import { useState } from "react";

const CONFIRM_WORD = "מחיקה";

export default function ResetDbForm({ importToken }: { importToken: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const armed = typed.trim() === CONFIRM_WORD;

  if (!open) {
    return (
      <button type="button" className="btn-danger" style={{ width: "auto" }} onClick={() => setOpen(true)}>
        איפוס מאגר (מחיקת כל הלקוחות)…
      </button>
    );
  }

  return (
    <form
      action="/api/admin/reset-db"
      method="POST"
      onSubmit={(e) => {
        if (!armed) e.preventDefault();
      }}
    >
      <input type="hidden" name="import_token" value={importToken} />
      <p style={{ fontSize: "13px", fontWeight: 600, color: "#b71c1c" }}>
        פעולה זו תמחק את כל הלקוחות לצמיתות. אין שחזור. כדי להמשיך, הקלידו: <strong>{CONFIRM_WORD}</strong>
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={CONFIRM_WORD}
        aria-label={`הקלידו ${CONFIRM_WORD} לאישור`}
        autoComplete="off"
        style={{ maxWidth: "200px" }}
      />
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="submit" className="btn-danger" disabled={!armed} style={{ width: "auto" }}>
          מחק את כל הלקוחות
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ width: "auto" }}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
