import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit } from "@/lib/ratelimit";

beforeEach(() => {
  // No Upstash env -> exercises the in-memory fallback.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("checkRateLimit (in-memory fallback)", () => {
  it("allows up to max requests then blocks", async () => {
    const ip = "rl-test-ip-1";
    const max = 3;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { ok } = await checkRateLimit(ip, "unit-key", max);
      results.push(ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("tracks different keys independently", async () => {
    const { ok: a } = await checkRateLimit("rl-test-ip-2", "key-a", 1);
    const { ok: b } = await checkRateLimit("rl-test-ip-2", "key-b", 1);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("returns a Promise (is async)", () => {
    expect(checkRateLimit("rl-test-ip-3", "key", 1)).toBeInstanceOf(Promise);
  });
});
