import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/admin/toggle/route";
import { COOKIE_NAME } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "toggle-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function toggleReq(fields: Record<string, string> = {}): NextRequest {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest("http://localhost/api/admin/toggle", { method: "POST", body: fd });
}

describe("POST /api/admin/toggle", () => {
  it("does NOT mint an admin session cookie on the auth-failure redirect", async () => {
    // No session cookie and no import token: getAdminSession() is false in the
    // test environment (next/headers cookies() throws outside a request
    // context and getSessionRole catches it), so this hits the rejection path.
    const res = await POST(toggleReq({ phone: "0501234567", action: "block" }));
    expect(res.status).toBe(303);
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(COOKIE_NAME);
  });
});
