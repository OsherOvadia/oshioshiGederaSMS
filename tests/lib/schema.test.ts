import { describe, it, expect } from "vitest";
import { applySchema, type DbConnection } from "@/lib/db";

function memoryDb(): DbConnection {
  // Same loading style as lib/db.ts — better-sqlite3 is callable without `new`.
  const BetterSqlite3 = require("better-sqlite3");
  return { type: "sqlite", conn: BetterSqlite3(":memory:") } as DbConnection;
}

describe("applySchema", () => {
  it("creates customers with consent columns and the gifts table", async () => {
    const db = memoryDb();
    await applySchema(db);
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    const custCols = db.conn.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
    const names = custCols.map((c) => c.name);
    expect(names).toContain("consent_at");
    expect(names).toContain("consent_version");
    expect(names).toContain("consent_ip");
    const giftCols = db.conn.prepare("PRAGMA table_info(gifts)").all() as { name: string }[];
    expect(giftCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "phone", "type", "period", "valid_from", "valid_until", "redeemed_at", "redeemed_by", "created_at"])
    );
  });

  it("is idempotent and enforces UNIQUE(phone, type, period)", async () => {
    const db = memoryDb();
    await applySchema(db);
    await applySchema(db); // second run must not throw
    if (db.type !== "sqlite") throw new Error("expected sqlite");
    db.conn
      .prepare("INSERT INTO gifts (phone, type, period, valid_from) VALUES (?, ?, ?, ?)")
      .run("+972501234567", "joining", "once", "2026-08-20");
    expect(() =>
      db.conn
        .prepare("INSERT INTO gifts (phone, type, period, valid_from) VALUES (?, ?, ?, ?)")
        .run("+972501234567", "joining", "once", "2026-08-20")
    ).toThrow(/UNIQUE/);
  });

  it("issues Postgres DDL with all consent ALTERs and no SQLite-isms", async () => {
    const captured: string[] = [];
    const fake = {
      type: "postgres",
      conn: {
        query: (sql: string) => {
          captured.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      },
    } as unknown as DbConnection;
    await applySchema(fake);

    const expectedAlters = [
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS received_message_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_version TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_ip TEXT",
    ];
    for (const alter of expectedAlters) {
      expect(captured).toContain(alter);
    }

    const giftsDdl = captured.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS gifts"));
    expect(giftsDdl).toBeDefined();
    expect(giftsDdl).toContain("SERIAL");

    // Pin the customers-schema .replace() conversion: no SQLite-ism may leak into PG SQL.
    for (const sql of captured) {
      expect(sql).not.toContain("AUTOINCREMENT");
      expect(sql).not.toContain("datetime('now')");
      expect(sql).not.toContain("INTEGER DEFAULT 1");
    }
  });
});
