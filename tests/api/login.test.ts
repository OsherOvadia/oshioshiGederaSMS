import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// getClientIp uses next/headers (request scope); stub it for unit testing.
// Each test gets its own IP bucket so the in-memory rate limiter (5/min/ip)
// never carries over between tests.
let ipCounter = 0;
vi.mock("@/lib/get-ip", () => ({ getClientIp: async () => `test-ip-login-${ipCounter}` }));

import { POST } from "@/app/api/login/route";
import { COOKIE_NAME, getTokenRole } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  ipCounter += 1;
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.ADMIN_PASSWORD = "login-test-pass";
  process.env.SECRET_KEY = "login-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function loginReq(password: string, username?: string): NextRequest {
  const fd = new FormData();
  if (username !== undefined) fd.set("username", username);
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

  it("returns role admin on a password-only login (no username field)", async () => {
    const res = await POST(loginReq("login-test-pass"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.role).toBe("admin");
  });

  it("logs the waiter in with their username + password and issues a waiter-role JWT", async () => {
    process.env.WAITER_USERNAME = "melzar";
    process.env.WAITER_PASSWORD = "waiter-test-pass";
    const res = await POST(loginReq("waiter-test-pass", "melzar"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, role: "waiter" });
    const token = res.cookies.get(COOKIE_NAME)?.value;
    expect(token).toBeTruthy();
    expect(await getTokenRole(token as string)).toBe("waiter");
  });

  it("rejects the waiter username with a wrong password", async () => {
    process.env.WAITER_USERNAME = "melzar";
    process.env.WAITER_PASSWORD = "waiter-test-pass";
    const res = await POST(loginReq("wrong", "melzar"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
  });

  it("never lets a non-admin username in via the admin password", async () => {
    process.env.WAITER_USERNAME = "melzar";
    process.env.WAITER_PASSWORD = "waiter-test-pass";
    const res = await POST(loginReq("login-test-pass", "someoneelse"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(COOKIE_NAME)?.value).toBeFalsy();
  });
});
