import { Redis } from "@upstash/redis";

const WINDOW_MS = 60 * 1000; // 1 minute window

// In-memory fallback (per serverless instance) — used only when Upstash is not configured.
const memStore = new Map<string, { count: number; resetAt: number }>();

let redisClient: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

function cleanupMemory(now: number): void {
  Array.from(memStore.entries()).forEach(([k, v]) => {
    if (v.resetAt < now) memStore.delete(k);
  });
}

function checkMemory(key: string, maxRequests: number): { ok: boolean; remaining: number } {
  const now = Date.now();
  if (memStore.size > 10000) cleanupMemory(now);
  let entry = memStore.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    memStore.set(key, entry);
  }
  entry.count += 1;
  return { ok: entry.count <= maxRequests, remaining: Math.max(0, maxRequests - entry.count) };
}

export async function checkRateLimit(
  ip: string,
  limitKey: string,
  maxRequests: number
): Promise<{ ok: boolean; remaining: number }> {
  const key = `rl:${ip}:${limitKey}`;
  const redis = getRedis();
  if (!redis) return checkMemory(key, maxRequests);
  try {
    // INCR + PEXPIRE in a single pipeline = one round-trip, executed atomically
    // server-side. This guarantees the key always gets a TTL (avoiding the
    // crash-between-INCR-and-PEXPIRE window that would leave a key with no
    // expiry, permanently locking out that ip+limitKey).
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.pexpire(key, WINDOW_MS);
    const [count] = (await pipe.exec()) as [number, number];
    return { ok: count <= maxRequests, remaining: Math.max(0, maxRequests - count) };
  } catch {
    // Redis hiccup — degrade gracefully to in-memory rather than locking users out.
    return checkMemory(key, maxRequests);
  }
}

// Predefined limits (same windows as the original Flask app).
export const LIMITS = {
  home: { max: 20, window: "minute" },
  submit: { max: 5, window: "minute" },
  login: { max: 5, window: "minute" },
  exportCsv: { max: 10, window: "hour" },
  broadcast: { max: 3, window: "hour" },
  forceInit: { max: 1, window: "hour" },
  sendSmsTask: { max: 100, window: "minute" },
  unsubscribe: { max: 10, window: "minute" },
} as const;
