import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// getClientIp uses next/headers (request scope); stub it for unit testing.
vi.mock("@/lib/get-ip", () => ({ getClientIp: async () => "test-ip-login" }));

import { POST } from "@/app/api/login/route";
import { COOKIE_NAME } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.ADMIN_PASSWORD = "login-test-pass";
  process.env.SECRET_KEY = "login-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function loginReq(password: string): NextRequest {
  const fd = new FormData();
  fd.set("password", password);
  return new NextRequest("http://localhost/api/login", { method: "POST", body: fd });
}

describe("POST /api/login", () => {
  it("sets the session cookie and does NOT return the token in the body on success", async () => {
    const res = await POST(loginReq("login-test-pass"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeTruthy();
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await POST(loginReq("wrong"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
  });
});
