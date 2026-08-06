// Rate limiter with optional Redis backend (REDIS_URL) and in-memory fallback.
import { logger, serializeError } from "@/lib/logger";

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, Bucket>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupMemory() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [k, v] of memoryStore) {
    if (v.resetAt < now) memoryStore.delete(k);
  }
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  backend: "redis" | "memory";
}

function rateLimitMemory(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  cleanupMemory();
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt < now) {
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    memoryStore.set(key, bucket);
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetAt: bucket.resetAt,
      backend: "memory",
    };
  }

  if (existing.count >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      resetAt: existing.resetAt,
      backend: "memory",
    };
  }

  existing.count += 1;
  return {
    success: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    backend: "memory",
  };
}

type RedisClient = {
  incr: (key: string) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<boolean>;
  pTTL: (key: string) => Promise<number>;
  connect: () => Promise<unknown>;
  on: (event: string, cb: (err: Error) => void) => void;
};

let redisClient: RedisClient | null = null;
let redisInit: Promise<RedisClient | null> | null = null;
let redisUnavailable = false;

async function getRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url || redisUnavailable) return null;

  if (redisClient) return redisClient;

  if (!redisInit) {
    redisInit = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url }) as unknown as RedisClient;
        client.on("error", (err) => {
          logger.warn("rate-limit redis client error", {
            errMessage: err.message,
          });
        });
        await client.connect();
        redisClient = client;
        return client;
      } catch (e: unknown) {
        redisUnavailable = true;
        logger.warn("rate-limit redis unavailable — falling back to in-memory", {
          ...serializeError(e),
        });
        return null;
      }
    })();
  }

  return redisInit;
}

async function rateLimitRedis(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const client = await getRedisClient();
  if (!client) return rateLimitMemory(key, limit, windowMs);

  const redisKey = `danets:rl:${key}`;
  try {
    const count = await client.incr(redisKey);
    if (count === 1) {
      await client.pExpire(redisKey, windowMs);
    }
    const ttl = await client.pTTL(redisKey);
    const resetAt = Date.now() + (ttl > 0 ? ttl : windowMs);
    const remaining = Math.max(0, limit - count);

    return {
      success: count <= limit,
      limit,
      remaining: count <= limit ? remaining : 0,
      resetAt,
      backend: "redis",
    };
  } catch (e: unknown) {
    logger.warn("rate-limit redis op failed — falling back to memory", {
      key,
      ...serializeError(e),
    });
    return rateLimitMemory(key, limit, windowMs);
  }
}

/** Async rate limit — uses Redis when REDIS_URL is set, else in-memory. */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (process.env.REDIS_URL?.trim()) {
    return rateLimitRedis(key, limit, windowMs);
  }
  return rateLimitMemory(key, limit, windowMs);
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Reset in-memory store (tests only). */
export function _resetRateLimitStoreForTests() {
  memoryStore.clear();
  redisUnavailable = false;
  redisClient = null;
  redisInit = null;
}
