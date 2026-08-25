import Link from "next/link";
import Logo from "../Logo";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const isWrong = error === "wrong";
  const isRate = error === "rate";
  const isSystem = error === "system";

  return (
    <main className="sheet sheet-narrow" id="main-content">
      <Logo />
      <p className="sheet-label">כניסת צוות</p>
      <h1>כניסה למערכת</h1>
      {/* Server-rendered errors (the no-JS POST path). role="alert" so they are
          announced when the page loads with ?error= in the URL. */}
      {isWrong && (
        <p className="error" role="alert">
          סיסמה שגויה
        </p>
      )}
      {isRate && (
        <p className="error" role="alert">
          יותר מדי ניסיונות. נסה שוב מאוחר יותר.
        </p>
      )}
      {isSystem && (
        <p className="error" role="alert">
          שגיאת מערכת. בדוק את ההגדרות (מאגר נתונים, SECRET_KEY).
        </p>
      )}
      <LoginForm />
      <footer className="sheet-foot">
        <Link href="/">חזרה לדף הבית</Link>
      </footer>
    </main>
  );
}
