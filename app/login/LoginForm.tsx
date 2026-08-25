"use client";

import { useEffect, useRef, useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Send focus back to the password field after a rejection, so a keyboard or
  // screen-reader user can retype immediately instead of tabbing back up.
  useEffect(() => {
    if (error) passwordRef.current?.focus();
  }, [error]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok === true) {
        // Session cookie is set by /api/login (Set-Cookie); just navigate.
        window.location.href = data.role === "waiter" ? "/waiter" : "/admin";
        return;
      }
      if (res.status === 429 || data.error === "rate") {
        setError("rate");
        return;
      }
      setError("wrong");
    } catch {
      setError("wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-describedby="login-feedback">
      <div className="form-group">
        {/* Placeholders are not labels: they vanish on the first keystroke and
            most screen readers skip them. */}
        <label htmlFor="login-username">שם משתמש</label>
        <input
          type="text"
          id="login-username"
          name="username"
          placeholder="ריק = מנהל"
          autoComplete="username"
          aria-describedby="login-username-hint"
          disabled={loading}
        />
        <p id="login-username-hint" className="field-hint">
          מלצרים מזינים שם משתמש; מנהל משאיר את השדה ריק.
        </p>
      </div>
      <div className="form-group">
        <label htmlFor="login-password">סיסמה</label>
        <input
          type="password"
          id="login-password"
          name="password"
          ref={passwordRef}
          required
          autoComplete="current-password"
          aria-invalid={error != null}
          disabled={loading}
        />
      </div>
      <p id="login-feedback" role="alert" aria-live="assertive" className="error form-feedback">
        {error === "wrong" && "סיסמה שגויה"}
        {error === "rate" && "יותר מדי ניסיונות. נסה שוב מאוחר יותר."}
      </p>
      <button type="submit" disabled={loading}>
        {loading ? "נכנס..." : "כניסה"}
      </button>
    </form>
  );
}
