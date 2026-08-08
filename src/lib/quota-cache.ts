import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-request memoization for expensive derived state (quota usage +
 * effective limits).
 *
 * Both helpers in `@/lib/plan-quota` hit the DB with ~13 parallel
 * `count()` queries. A single request — e.g. `GET /api/subscription`
 * — can call them more than once when the handler also reads them
 * directly, when middleware reads them, or when the shell calls them
 * during bootstrap. Without memoization the same 13 queries run twice
 * per request.
 *
 * AsyncLocalStorage gives us a per-request cache that automatically
 * scopes to the call chain (no key collision between concurrent
 * requests, no manual invalidation needed) and is reset between
 * requests because each `apiHandler` invocation is wrapped in its
 * own context.
 *
 * The cache is read-through: miss → call the supplied loader → store
 * the result in the local context → return.
 */

type CacheKey = string;

interface QuotaCache {
  usage: Map<CacheKey, unknown>;
  limits: Map<CacheKey, unknown>;
}

const storage = new AsyncLocalStorage<QuotaCache>();

function ctx(): QuotaCache {
  const existing = storage.getStore();
  if (existing) return existing;
  // Outside any apiHandler / withRequestContext scope the cache is a
  // throw-away — calls won't share state but won't crash either.
  return { usage: new Map(), limits: new Map() };
}

function getOrInit(): QuotaCache {
  const existing = storage.getStore();
  if (existing) return existing;
  // Bind a new empty cache to the rest of this async call chain.
  // The store is set inside `withQuotaCache()` below; if it's not
  // already wrapped, callers still get a working but non-shared cache.
  return { usage: new Map(), limits: new Map() };
}

/**
 * Wrap a request handler so all `getCachedQuota*` calls share a cache.
 * Idempotent — nesting is fine, the outer store wins.
 */
export async function withQuotaCache<T>(fn: () => Promise<T>): Promise<T> {
  const existing = storage.getStore();
  if (existing) return fn();
  return new Promise((resolve, reject) => {
    const cache: QuotaCache = { usage: new Map(), limits: new Map() };
    storage.run(cache, async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Cache result of `getQuotaUsage(businessId)` for the duration of the
 * current request. Calls after the first are O(1) and never touch the DB.
 */
export async function getCachedQuotaUsage<T>(
  businessId: string,
  loader: () => Promise<T>
): Promise<T> {
  const cache = getOrInit();
  const key = businessId;
  if (cache.usage.has(key)) return cache.usage.get(key) as T;
  const value = await loader();
  cache.usage.set(key, value);
  return value;
}

/**
 * Cache result of `getEffectiveLimits(businessId, planName?)`. Keyed
 * on (businessId, planName) because the override can change between
 * requests but is constant within a single one.
 */
export async function getCachedEffectiveLimits<T>(
  businessId: string,
  planName: string | undefined,
  loader: () => Promise<T>
): Promise<T> {
  const cache = getOrInit();
  const key = `${businessId}|${planName ?? ""}`;
  if (cache.limits.has(key)) return cache.limits.get(key) as T;
  const value = await loader();
  cache.limits.set(key, value);
  return value;
}
