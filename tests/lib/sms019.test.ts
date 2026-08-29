import { describe, it, expect, afterEach, vi } from "vitest";
import { sms019Provider, to019Destination } from "@/lib/sms/providers/sms019";

/**
 * Unit tests for the 019 adapter against a stubbed fetch: the exact request
 * shape their documented API expects, and the mapping of their status codes
 * onto the app's SendSmsResult. No test here can reach the network.
 */

function stubCreds() {
  vi.stubEnv("SMS_019_TOKEN", "token-abc");
  vi.stubEnv("SMS_019_USERNAME", "oshioshi");
  vi.stubEnv("SMS_SENDER_ID", "OshiOshi");
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("to019Destination", () => {
  it("converts canonical +972 mobiles to local 05X format", () => {
    expect(to019Destination("+972501234567")).toEqual({ phone: "0501234567", international: false });
  });
  it("passes local numbers through", () => {
    expect(to019Destination("0501234567")).toEqual({ phone: "0501234567", international: false });
  });
  it("marks non-Israeli numbers international, digits only", () => {
    expect(to019Destination("+14155551212")).toEqual({ phone: "14155551212", international: true });
  });
});

describe("isConfigured", () => {
  it("requires token, username and a valid sender id", () => {
    expect(sms019Provider.isConfigured()).toBe(false);
    stubCreds();
    expect(sms019Provider.isConfigured()).toBe(true);
  });

  it("rejects sender ids 019 would refuse (Hebrew, too long, '+')", () => {
    vi.stubEnv("SMS_019_TOKEN", "t");
    vi.stubEnv("SMS_019_USERNAME", "u");
    for (const bad of ["אושיאושי", "OshiOshiGedera", "+97250000", "Oshi Oshi", ""]) {
      vi.stubEnv("SMS_SENDER_ID", bad);
      expect(sms019Provider.isConfigured()).toBe(false);
    }
  });
});

describe("send", () => {
  it("posts the documented payload with Bearer auth and maps status 0 to success", async () => {
    stubCreds();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(okJson({ status: 0, message: "SMS will be sent", shipment_id: "123" }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await sms019Provider.send({ to: "+972501234567", text: "שלום מאושי אושי" });
    expect(res.ok).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://019sms.co.il/api");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body)).toEqual({
      sms: {
        user: { username: "oshioshi" },
        source: "OshiOshi",
        destinations: { phone: [{ _: "0501234567" }] },
        message: "שלום מאושי אושי",
      },
    });
  });

  it("a per-message senderId overrides the env sender", async () => {
    stubCreds();
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ status: 0 }));
    vi.stubGlobal("fetch", fetchSpy);
    await sms019Provider.send({ to: "0501234567", text: "hi", senderId: "Gedera" });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).sms.source).toBe("Gedera");
  });

  it("flags international destinations", async () => {
    stubCreds();
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ status: 0 }));
    vi.stubGlobal("fetch", fetchSpy);
    await sms019Provider.send({ to: "+14155551212", text: "hi" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.sms.includes_international).toBe("1");
    expect(body.sms.destinations.phone[0]._).toBe("14155551212");
  });

  it("maps a non-zero 019 status to a failure with their message", async () => {
    stubCreds();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ status: 4, message: "not enough credit" })));
    const res = await sms019Provider.send({ to: "0501234567", text: "hi" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("019 status 4: not enough credit");
  });

  it("surfaces HTTP-level failures with the status code", async () => {
    stubCreds();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" })
    );
    const res = await sms019Provider.send({ to: "0501234567", text: "hi" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.error).toContain("unavailable");
    }
  });

  it("surfaces network errors without throwing", async () => {
    stubCreds();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const res = await sms019Provider.send({ to: "0501234567", text: "hi" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("ECONNRESET");
  });

  it("refuses an invalid sender id before any network call", async () => {
    vi.stubEnv("SMS_019_TOKEN", "t");
    vi.stubEnv("SMS_019_USERNAME", "u");
    vi.stubEnv("SMS_SENDER_ID", "שם בעברית");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sms019Provider.send({ to: "0501234567", text: "hi" });
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
