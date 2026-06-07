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
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <h2 className="success">הוסרת בהצלחה</h2>
      <p>לא תקבל יותר הודעות מאיתנו.</p>
    </div>
  );
}
