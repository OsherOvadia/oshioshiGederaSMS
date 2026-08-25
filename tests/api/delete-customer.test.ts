import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/admin/delete-customer/route";
import { COOKIE_NAME } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "delete-customer-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function deleteReq(fields: Record<string, string> = {}): NextRequest {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest("http://localhost/api/admin/delete-customer", { method: "POST", body: fd });
}

describe("POST /api/admin/delete-customer", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    // No session cookie and no import token: getAdminSession() is false in the
    // test environment (next/headers cookies() throws outside a request
    // context and getSessionRole catches it), so this hits the rejection path
    // and returns before any DB connection is opened.
    const res = await POST(deleteReq({ phone: "0501234567" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin");
    expect(res.headers.get("location")).not.toContain("%D7%A0%D7%9E%D7%97%D7%A7"); // no "deleted" message
  });

  it("does NOT mint an admin session cookie on the auth-failure redirect", async () => {
    const res = await POST(deleteReq({ phone: "0501234567" }));
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(COOKIE_NAME);
  });
});
