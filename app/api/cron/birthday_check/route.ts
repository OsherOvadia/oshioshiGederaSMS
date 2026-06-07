import { NextRequest, NextResponse } from "next/server";
import { getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getBirthMonth } from "@/lib/dates";
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const authHeader = req.headers.get("Authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${CRON_SECRET}` && secretParam !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  const db = getDb();
  const activeCondition = db.type === "postgres" ? "WHERE active = TRUE" : "WHERE active = 1";
  const rows = await queryCustomers(
    db,
    `SELECT phone, name, date_of_birth FROM customers ${activeCondition}`,
    []
  );
  if (db.type === "sqlite") db.conn.close();

  const birthdaysFound: [string, string][] = [];
  for (const row of rows) {
    const month = getBirthMonth(row.date_of_birth as string);
    if (month === currentMonth) {
      birthdaysFound.push([String(row.phone), String(row.name ?? "")]);
    }
  }

  const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();
  let sentCount = 0;

  if (QSTASH_TOKEN && baseUrl) {
    for (const [phone, name] of birthdaysFound) {
      const msg = `היי ${name}, חוגג/ת יום הולדת החודש? 🎂\nמזל טוב! מחכה לך הטבה מיוחדת ב-Sushi VIP. בואו לחגוג איתנו! 🍣`;
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: msg,
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
      });
      if (r.ok) sentCount += 1;
      else console.error("Failed to queue birthday sms for", phone, r.error);
    }
  }

  return NextResponse.json({
    status: "success",
    month: currentMonth,
    found: birthdaysFound.length,
    queued: sentCount,
  });
}
