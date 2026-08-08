/**
 * Cursor-based pagination helpers for list endpoints.
 *
 * Why cursors, not offset?
 *   - Offset pagination on a `LIMIT/OFFSET` query has to scan + discard
 *     the skipped rows every time. For deep pages (page 50 of a 10k
 *     listing) this is O(n) and feels slow.
 *   - Cursors are O(1) per page as long as the order-by column is
 *     indexed. The cursor is the `createdAt` timestamp + `id` of the
 *     last row from the prior page; the next page queries
 *     `createdAt < cursor` (or `>` for ascending).
 *   - Cursors are also stable under inserts — a new lead landing
 *     between pages won't shift the page boundary.
 *
 * The cursor is base64(JSON({t, id})) so we can add new fields later
 * without breaking callers (decode tolerates unknown keys).
 */

export interface Cursor {
  t: string; // ISO timestamp of the last row's sort key
  id: string; // id of the last row, used as the tiebreaker
}

const ENCODER = "base64url" as const;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString(ENCODER);
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, ENCODER).toString("utf8");
    const parsed = JSON.parse(json) as Partial<Cursor>;
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    return { t: parsed.t, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Build a Prisma `where` clause that pages strictly before `cursor`
 * using `(createdAt, id)` as a compound key. Same shape as the
 * `Business_purgeScheduledAt_idx`-style indexes we added in P17.
 */
export function beforeCursorWhere(cursor: Cursor | null): {
  createdAt?: { lt: Date };
} {
  if (!cursor) return {};
  const t = new Date(cursor.t);
  return {
    createdAt: { lt: t },
  };
}

/**
 * Same as `beforeCursorWhere` but for any sortable timestamp column.
 * Use this when the list is ordered by something other than `createdAt`
 * (e.g. conversations by `updatedAt`).
 */
export function beforeTimestampCursor(
  cursor: Cursor | null,
  column: "updatedAt" | "publishedAt" | "createdAt" = "createdAt"
) {
  if (!cursor) return {};
  const t = new Date(cursor.t);
  return { [column]: { lt: t } } as Record<string, { lt: Date }>;
}

/**
 * Cap the page size — guard against `?take=10000` DoS.
 */
export function clampPageSize(
  requested: number | null | undefined,
  defaultSize = 50,
  maxSize = 200
): number {
  const n = typeof requested === "number" && requested > 0 ? Math.floor(requested) : defaultSize;
  return Math.min(n, maxSize);
}