"use client";

import { useState, useRef } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "אנא מלאו את כל שדות החובה",
  invalid_phone: "מספר טלפון לא תקין",
  invalid_email: 'כתובת דוא"ל לא תקינה',
  already_registered: "אתם כבר רשומים למועדון! המספר שלכם כבר קיים במערכת.",
  system: "תקלה במערכת",
  rate: "יותר מדי בקשות. נסו שוב מאוחר יותר.",
  consent: "כדי להצטרף למועדון יש לאשר קבלת הודעות SMS",
};

// Optional business contact for the success screen; buttons hide when unset.
const BUSINESS_PHONE = process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? "";
const WHATSAPP_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";

export default function VIPForm({ unsubKeyword }: { unsubKeyword: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = formRef.current;
    if (!form) return;

    setLoading(true);
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });
      const data = await res.json();

      if (data.success) {
        setDone(true);
      } else if (data.error && ERROR_MESSAGES[data.error]) {
        setError(ERROR_MESSAGES[data.error]);
      } else {
        setError("שגיאה. נסו שוב.");
      }
    } catch {
      setError("תקלה במערכת. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="success-view" role="status">
        <div className="success-check" aria-hidden="true">
          ✓
        </div>
        <h3>איזה כיף שהצטרפת! 🎉</h3>
        <p>מעכשיו ההטבות, מבצעי ה-1+1 והפינוקים מגיעים ישירות אליך ב-SMS.</p>
        {(BUSINESS_PHONE || WHATSAPP_PHONE) && (
          <div className="success-actions">
            {BUSINESS_PHONE && (
              <a className="btn-ghost" href={`tel:${BUSINESS_PHONE}`}>
                📞 חיוג למסעדה
              </a>
            )}
            {WHATSAPP_PHONE && (
              <a
                className="btn-ghost"
                href={`https://wa.me/${WHATSAPP_PHONE}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                💬 וואטסאפ
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} aria-describedby="form-feedback">
        <div className="form-group">
          <label htmlFor="name">שם מלא *</label>
          <input type="text" id="name" name="name" placeholder="שמך" required maxLength={100} autoComplete="name" />
        </div>
        <div className="form-group">
          <label htmlFor="phone">טלפון נייד *</label>
          <input
            type="tel"
            id="phone"
            name="phone"
            className="input-ltr"
            dir="ltr"
            placeholder="050-1234567"
            required
            maxLength={20}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <div className="form-group">
          <label htmlFor="email">דוא&quot;ל *</label>
          <input
            type="email"
            id="email"
            name="email"
            className="input-ltr"
            dir="ltr"
            placeholder="example@email.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="form-group">
          <label htmlFor="dob">
            תאריך לידה * <span className="label-hint">— כדי שנדע מתי לפנק 🎂</span>
          </label>
          <input type="date" id="dob" name="date_of_birth" required autoComplete="bday" />
        </div>
        <div className="form-group">
          <label htmlFor="wedding">
            יום נישואין <span className="label-hint">— לא חובה, כדי שנוכל לפנק גם ביום הנישואין 💍</span>
          </label>
          <input type="date" id="wedding" name="wedding_day" />
        </div>
        <div className="form-group">
          <label htmlFor="city">עיר *</label>
          <input type="text" id="city" name="city" placeholder="גדרה" maxLength={50} required />
        </div>
        <div className="form-group consent-group">
          <label className="consent-label">
            <input type="checkbox" name="consent" required />
            <span>
              אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל
              מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם ל
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                תקנון המועדון ומדיניות הפרטיות
              </a>
              . ניתן להסיר את ההסכמה בכל עת, ללא עלות, במענה &quot;{unsubKeyword}&quot; לכל הודעה או
              בקישור ההסרה שבה.
            </span>
          </label>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "שולח..." : "אני בפנים 🍣"}
        </button>
      </form>
      <p id="form-feedback" role="alert" aria-live="assertive" className="error" style={{ marginTop: "14px", marginBottom: 0 }}>
        {error}
      </p>
    </>
  );
}
