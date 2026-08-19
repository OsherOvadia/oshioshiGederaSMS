import { describe, expect, it } from "vitest";
import { parseSubmitFields } from "@/lib/submit-form";

const valid = {
  name: "  שרה כהן ",
  phone: "050-1234567",
  email: "sara@example.com",
  date_of_birth: "1990-05-12",
  wedding_day: "2015-08-01",
  city: "גדרה",
  consent: "on",
};

describe("parseSubmitFields", () => {
  it("accepts a full valid submission, trimming and normalizing the phone", () => {
    const r = parseSubmitFields(valid);
    expect(r).toEqual({
      ok: true,
      fields: {
        name: "שרה כהן",
        phone: "+972501234567",
        email: "sara@example.com",
        dob: "1990-05-12",
        wedding: "2015-08-01",
        city: "גדרה",
      },
    });
  });

  it("accepts a submission with no wedding day (optional field)", () => {
    const r = parseSubmitFields({ ...valid, wedding_day: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.wedding).toBe("");
  });

  it("accepts a submission with wedding_day absent entirely", () => {
    const { wedding_day: _omit, ...rest } = valid;
    const r = parseSubmitFields(rest);
    expect(r.ok).toBe(true);
  });

  it.each(["name", "phone", "email", "date_of_birth", "city"] as const)(
    "rejects with 'missing' when %s is empty",
    (key) => {
      const r = parseSubmitFields({ ...valid, [key]: "   " });
      expect(r).toEqual({ ok: false, error: "missing" });
    }
  );

  it("rejects an invalid phone", () => {
    const r = parseSubmitFields({ ...valid, phone: "123" });
    expect(r).toEqual({ ok: false, error: "invalid_phone" });
  });

  it("rejects an invalid email", () => {
    const r = parseSubmitFields({ ...valid, email: "not-an-email" });
    expect(r).toEqual({ ok: false, error: "invalid_email" });
  });

  it("caps oversized values instead of failing", () => {
    const r = parseSubmitFields({ ...valid, name: "א".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.name).toHaveLength(100);
  });

  it("treats non-string values (e.g. a File) as empty", () => {
    const r = parseSubmitFields({ ...valid, name: 42 });
    expect(r).toEqual({ ok: false, error: "missing" });
  });
});

describe("consent", () => {
  const valid = {
    name: "דנה",
    phone: "0501234567",
    email: "a@b.co",
    date_of_birth: "1990-08-15",
    wedding_day: "",
    city: "גדרה",
  };
  it("rejects a submission without the consent checkbox", () => {
    const res = parseSubmitFields({ ...valid });
    expect(res).toEqual({ ok: false, error: "consent" });
  });
  it("accepts checkbox value 'on'", () => {
    const res = parseSubmitFields({ ...valid, consent: "on" });
    expect(res.ok).toBe(true);
  });
  it("rejects consent values that aren't an affirmative checkbox", () => {
    expect(parseSubmitFields({ ...valid, consent: "" }).ok).toBe(false);
    expect(parseSubmitFields({ ...valid, consent: "off" }).ok).toBe(false);
  });
});
