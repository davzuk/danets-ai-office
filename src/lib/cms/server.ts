/**
 * Server-side helpers for the CMS admin API.
 *
 *  - requireCmsAdmin: gates the admin routes (super admin only)
 *  - revalidateCms: flushes the cached CMS read helpers so the public
 *    site immediately reflects edits
 *  - parseBlocks: defensively parses the `blocks` JSON column
 */

import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/super-admin";

export type CmsActor = {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
};

export async function requireCmsAdmin(): Promise<
  | { ok: true; actor: CmsActor }
  | { ok: false; error: NextResponse }
> {
  const auth = await requireSuperAdmin();
  if (!auth.success) return { ok: false, error: auth.error };
  return {
    ok: true,
    actor: {
      userId: auth.user.userId,
      email: auth.user.email,
      name: auth.user.name,
      isPlatformAdmin: auth.isPlatformAdmin,
    },
  };
}

/**
 * Flush cached CMS data + revalidate the public routes that depend on
 * it. Pass the slugs that were affected so targeted paths get rebuilt
 * (cheaper than `revalidatePath('/', 'layout')`).
 */
export function revalidateCms(opts?: {
  pageSlugs?: string[];
  postSlugs?: string[];
  navChanged?: boolean;
  blocksChanged?: boolean;
  siteChanged?: boolean;
}) {
  // Invalidate the cache tags so the unstable_cache wrappers refresh.
  // Next.js 16 requires a cache-life profile on every tag invalidation.
  revalidateTag("cms", "default");

  if (opts?.siteChanged) revalidateTag("cms:site", "default");
  if (opts?.navChanged) revalidateTag("cms:nav", "default");
  if (opts?.blocksChanged) revalidateTag("cms:blocks", "default");
  if (opts?.pageSlugs) {
    for (const slug of opts.pageSlugs) {
      revalidatePath(`/${slug}`);
      revalidateTag("cms:pages", "default");
    }
  }
  if (opts?.postSlugs) {
    for (const slug of opts.postSlugs) {
      revalidatePath(`/blog/${slug}`);
      revalidateTag("cms:posts", "default");
    }
  }
}

/**
 * Block list normalization. Editor uses either `{ blockKey, props }`
 * short form or `{ id, blockKey, props }` long form; we persist only
 * the short form to keep the JSON column tidy.
 */
export const blockSchema = z.object({
  blockKey: z.string().min(1).max(64),
  props: z.record(z.string(), z.any()).default({}),
});

export const blocksArraySchema = z.array(blockSchema).max(40);

export function parseBlocksColumn(raw: unknown): z.infer<typeof blockSchema>[] {
  if (!Array.isArray(raw)) return [];
  const out: z.infer<typeof blockSchema>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const blockKey = typeof e.blockKey === "string" ? e.blockKey : null;
    if (!blockKey) continue;
    const props =
      e.props && typeof e.props === "object"
        ? (e.props as Record<string, unknown>)
        : {};
    out.push({ blockKey, props });
  }
  return out;
}

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case");

export const seoSchema = z
  .object({
    title: z.string().max(160).optional(),
    description: z.string().max(320).optional(),
    canonical: z.string().url().optional(),
    noindex: z.boolean().optional(),
    ogImage: z.string().url().optional(),
  })
  .partial()
  .optional();
