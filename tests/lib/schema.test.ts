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
    ).toThrow();
  });
});
