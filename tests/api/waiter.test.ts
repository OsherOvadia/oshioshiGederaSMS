import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// getClientIp uses next/headers (request scope); stub it for unit testing.
// Each test gets its own IP bucket so the in-memory rate limiter (30/min/ip)
// never carries over between tests.
let ipCounter = 0;
vi.mock("@/lib/get-ip", () => ({ getClientIp: async () => `test-ip-waiter-${ipCounter}` }));

// getSessionRole also uses next/headers cookies(), which is unavailable
// outside a request context. Mock it with a mutable role so each test picks
// its session: null (logged out) or "waiter". The role variable is only read
// when the route calls getSessionRole(), safely after initialization.
let role: "admin" | "waiter" | null = null;
vi.mock("@/lib/auth", () => ({ getSessionRole: async () => role }));

import { GET as customersGET } from "@/app/api/waiter/customers/route";
import { POST as redeemPOST } from "@/app/api/waiter/redeem/route";
import { COOKIE_NAME } from "@/lib/session-jwt";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  ipCounter += 1;
  role = null;
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "waiter-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function redeemReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/waiter/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/waiter/customers", () => {
  it("returns 401 with no session and does not set any cookie", async () => {
    const res = await customersGET(new NextRequest("http://localhost/api/waiter/customers?q=abc"));
    expect(res.status).toBe(401);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(COOKIE_NAME);
    expect(setCookie).toBe("");
  });
});

describe("POST /api/waiter/redeem", () => {
  it("returns 401 with no session", async () => {
    const res = await redeemPOST(redeemReq({ giftId: 1 }));
    expect(res.status).toBe(401);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(COOKIE_NAME);
  });

  it("rejects a non-JSON body with 400 for a waiter session", async () => {
    role = "waiter";
    const res = await redeemPOST(redeemReq("not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });

  it.each([
    ["boolean true (Number coerces to 1)", true],
    ["numeric string", "7"],
    ["array wrapping a number", ["7"]],
    ["float", 7.5],
    ["zero", 0],
    ["negative", -3],
    ["missing giftId", undefined],
  ])("rejects giftId %s with 400 for a waiter session", async (_label, giftId) => {
    role = "waiter";
    const res = await redeemPOST(redeemReq(giftId === undefined ? {} : { giftId }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });
});
