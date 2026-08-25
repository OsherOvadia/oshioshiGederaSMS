import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/security";
import { deactivateByPhone } from "@/lib/unsubscribe";
import Logo from "@/app/Logo";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { phone: phoneParam } = await params;
  const { token } = await searchParams;

  if (!token) redirect("/");

  const clean = phoneParam.replace(/[^\d+]/g, "").slice(0, 20);
  const withPlus = clean.startsWith("+") ? clean : "+" + clean;
  const digitsOnly = clean.replace("+", "");

  if (!verifyToken(withPlus, token) && !verifyToken(digitsOnly, token)) {
    redirect("/");
  }

  try {
    await deactivateByPhone(withPlus);
  } catch (e) {
    console.error("Unsubscribe error:", e);
  }

  return (
    <main className="container" id="main-content">
      <div className="logo-area">
        <Logo />
      </div>
      <h1 className="success">הוסרת בהצלחה</h1>
      <p>לא תקבלו מאיתנו יותר הודעות.</p>
      <p>התחרטתם? תמיד אפשר לחזור — ניתן להירשם מחדש בכל רגע.</p>
      <a className="btn-ghost" href="/">
        הצטרפות מחדש למועדון
      </a>
    </main>
  );
}
