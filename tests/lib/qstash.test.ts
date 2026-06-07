import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getQstashPublishBase, normalizeBaseUrl, resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("getQstashPublishBase", () => {
  it("defaults to the global host when QSTASH_URL is unset", () => {
    delete process.env.QSTASH_URL;
    expect(getQstashPublishBase()).toBe("https://qstash.upstash.io");
  });
  it("returns the origin of QSTASH_URL when set (EU region)", () => {
    process.env.QSTASH_URL = "https://eu1-foo-bar.upstash.io/v2/publish";
    expect(getQstashPublishBase()).toBe("https://eu1-foo-bar.upstash.io");
  });
  it("adds https:// to a bare host", () => {
    process.env.QSTASH_URL = "eu1-foo-bar.upstash.io";
    expect(getQstashPublishBase()).toBe("https://eu1-foo-bar.upstash.io");
  });
});

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes and keeps https", () => {
    expect(normalizeBaseUrl("https://app.example.com/")).toBe("https://app.example.com");
  });
  it("prefixes https:// for a bare host", () => {
    expect(normalizeBaseUrl("app.example.com")).toBe("https://app.example.com");
  });
  it("returns empty string for undefined or literal 'undefined'", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl("https://undefined")).toBe("");
  });
});

describe("resolveAppBaseUrl", () => {
  it("prefers the request origin", () => {
    process.env.APP_URL = "https://fallback.example.com";
    expect(resolveAppBaseUrl("https://live.example.com")).toBe("https://live.example.com");
  });
  it("falls back to APP_URL when no origin", () => {
    delete process.env.VERCEL_URL;
    process.env.APP_URL = "https://fallback.example.com";
    expect(resolveAppBaseUrl(undefined)).toBe("https://fallback.example.com");
  });
});

describe("publishSmsTask", () => {
  it("posts to <base>/v2/publish/<endpoint> and reports ok", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await publishSmsTask({
      targetEndpoint: "https://app.example.com/api/send_sms_task",
      phone: "+972501234567",
      message: "hi",
      secret: "s",
      token: "qstash-token",
    });
    expect(res.ok).toBe(true);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "https://qstash.upstash.io/v2/publish/https://app.example.com/api/send_sms_task"
    );
  });
  it("reports not-ok with status text on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 401 })));
    const res = await publishSmsTask({
      targetEndpoint: "https://app.example.com/api/send_sms_task",
      phone: "+972501234567",
      message: "hi",
      secret: "s",
      token: "qstash-token",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });
});
