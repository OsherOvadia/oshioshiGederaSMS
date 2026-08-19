import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth";
import WaiterPanel from "./WaiterPanel";

export const dynamic = "force-dynamic";

export default async function WaiterPage() {
  const role = await getSessionRole();
  if (role !== "waiter" && role !== "admin") redirect("/login");
  return (
    <main className="container waiter-page">
      <h1>מסך מלצרים 🍣</h1>
      <p className="waiter-sub">חיפוש לקוח לפי שם או טלפון, וסימון מתנות שמומשו.</p>
      <WaiterPanel />
    </main>
  );
}
