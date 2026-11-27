import "server-only";
// Tenant site and page changes. Sites are built by the platform (super
// admins in the platform console), never by tenants themselves.

import { Prisma, type LandingPage } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { requireQuota } from "@/lib/plan-quota";
import { PAGE_SLUG_RE, RESERVED_PAGE_SLUGS, siteOrigin, subdomainProblem, suggestSubdomain } from "./host";
import { findPlaceholders, newBlock, pageBlocksSchema, pageSeoSchema, readBlocks, validateBlocks, type BlockIssue, type ParsedBlock, type SiteBlock, type SiteBlockKey } from "./blocks";
import { readPageSeo } from "./server";

export interface Actor {
  businessId: string;
  /** A tenant user; absent for platform admins. */
  userId?: string;
  name: string;
}

const log = (a: Actor, action: string, description: string, metadata?: Record<string, unknown>) =>
  logActivity({ businessId: a.businessId, userId: a.userId, userName: a.name, action, module: "sites", description, metadata });

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ─── Site ──────────────────────────────────────────────────────────

/** A free subdomain close to the business name. */
export async function availableSubdomain(name: string): Promise<string> {
  const base = suggestSubdomain(name);
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base.slice(0, 28)}-${n + 1}`;
    if (subdomainProblem(candidate)) continue;
    const taken = await db.tenantSite.findUnique({ where: { subdomain: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36)}`;
}

export async function assertSubdomainFree(subdomain: string, siteId?: string) {
  const problem = subdomainProblem(subdomain);
  if (problem) throw new AppError(problem, { status: 400, code: "INVALID_SUBDOMAIN" });
  const taken = await db.tenantSite.findUnique({ where: { subdomain }, select: { id: true } });
  if (taken && taken.id !== siteId) throw new AppError("That address is taken. Try another.", { status: 409, code: "SUBDOMAIN_TAKEN" });
}

/** Starting blocks for a new page. */
export function starterBlocks(template: "blank" | "home", name: string): SiteBlock[] {
  if (template === "blank") return [];
  const keys: SiteBlockKey[] = ["hero", "feature-grid", "testimonials", "faq", "contact-details", "cta"];
  return keys.map((k, i) => {
    const b = newBlock(k, `b${i + 1}`);
    if (k === "hero") b.props = { ...b.props, title: `Welcome to ${name}` };
    return b;
  });
}

export async function createSite(a: Actor, subdomain: string, businessName: string) {
  await assertSubdomainFree(subdomain);
  const existing = await db.tenantSite.findUnique({ where: { businessId: a.businessId }, select: { id: true } });
  if (existing) throw new AppError("This business already has a website.", { status: 409, code: "SITE_EXISTS" });
  try {
    const site = await db.$transaction(async (tx) => {
      const s = await tx.tenantSite.create({ data: { businessId: a.businessId, subdomain } });
      await tx.landingPage.create({
        data: { businessId: a.businessId, siteId: s.id, slug: "", title: "Home", blocks: json(starterBlocks("home", businessName)) },
      });
      return s;
    });
    await log(a, "create", `Set up the website at ${siteOrigin(subdomain) ?? subdomain}`);
    return site;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("That address is taken. Try another.", { status: 409, code: "SUBDOMAIN_TAKEN" });
    }
    throw e;
  }
}

// ─── Pages ─────────────────────────────────────────────────────────

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

export function slugProblem(slug: string): string | null {
  if (slug === "") return null;
  if (!PAGE_SLUG_RE.test(slug)) return "Use lowercase letters, numbers and hyphens, with up to 3 parts separated by /.";
  if (RESERVED_PAGE_SLUGS.has(slug.split("/")[0])) return "That address is reserved. Choose another.";
  return null;
}

async function assertSlugFree(siteId: string, slug: string, pageId?: string) {
  const problem = slugProblem(slug);
  if (problem) throw new AppError(problem, { status: 400, code: "INVALID_SLUG" });
  const taken = await db.landingPage.findUnique({ where: { siteId_slug: { siteId, slug } }, select: { id: true } });
  if (taken && taken.id !== pageId) {
    throw new AppError(slug ? "Another page already uses that address." : "This site already has a home page.", { status: 409, code: "SLUG_TAKEN" });
  }
}

export async function getSiteOrThrow(businessId: string) {
  const site = await db.tenantSite.findUnique({ where: { businessId } });
  if (!site) throw new AppError("Set up your website first.", { status: 404, code: "NO_SITE" });
  return site;
}

export async function getPageOrThrow(businessId: string, id: string) {
  const page = await db.landingPage.findFirst({ where: { id, businessId } });
  if (!page) throw new AppError("Page not found.", { status: 404, code: "NOT_FOUND" });
  return page;
}

export async function createPage(a: Actor, input: { title: string; slug: string; template: "blank" | "home" }, businessName: string) {
  const site = await getSiteOrThrow(a.businessId);
  const slug = normalizeSlug(input.slug);
  await assertSlugFree(site.id, slug);
  const page = await db.landingPage.create({
    data: { businessId: a.businessId, siteId: site.id, slug, title: input.title.trim(), blocks: json(starterBlocks(input.template, businessName)) },
  });
  await log(a, "create", `Created the page "${page.title}"`);
  return page;
}

/** A free slug close to the one asked for ("offer", "offer-2", …). */
export async function freeSlug(siteId: string, wanted: string): Promise<string> {
  const cleaned = normalizeSlug(wanted)
    .replace(/[^a-z0-9/-]+/g, "-")
    .split("/")
    .map((part) => part.replace(/-+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .slice(0, 3)
    .join("/")
    .slice(0, 50);
  const base = cleaned && !slugProblem(cleaned) ? cleaned : "page";
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 45)}-${n}`;
    const taken = await db.landingPage.findUnique({ where: { siteId_slug: { siteId, slug: candidate } }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base.slice(0, 40)}-${Date.now().toString(36)}`;
}

/** Save an AI-built page as a draft (workstream R). */
export async function createGeneratedPage(
  a: Actor,
  input: { title: string; slug: string; blocks: SiteBlock[]; seo: { title?: string; description?: string }; prompt: string }
) {
  const site = await getSiteOrThrow(a.businessId);
  const slug = await freeSlug(site.id, input.slug);
  const blocks = pageBlocksSchema.parse(input.blocks);
  const seo = pageSeoSchema.parse(input.seo);
  const page = await db.landingPage.create({
    data: {
      businessId: a.businessId,
      siteId: site.id,
      slug,
      title: input.title.trim().slice(0, 200) || "Landing page",
      blocks: json(blocks),
      seo: json(seo),
      generatedFrom: input.prompt.slice(0, 5000),
    },
  });
  await log(a, "create", `Generated the page "${page.title}" (/${page.slug}) with AI`);
  return page;
}

export interface PageEdit {
  title?: string;
  slug?: string;
  blocks?: unknown;
  seo?: unknown;
}

/** Save the draft. A published page keeps showing its published blocks until it's published again. */
export async function savePage(a: Actor, id: string, edit: PageEdit): Promise<LandingPage> {
  const page = await getPageOrThrow(a.businessId, id);
  const data: Prisma.LandingPageUpdateInput = {};
  if (edit.title !== undefined) {
    const t = edit.title.trim();
    if (!t || t.length > 200) throw new AppError("Give the page a title (up to 200 characters).", { status: 400, code: "INVALID_INPUT" });
    data.title = t;
  }
  if (edit.slug !== undefined) {
    const slug = normalizeSlug(edit.slug);
    if (slug !== page.slug) {
      await assertSlugFree(page.siteId, slug, page.id);
      data.slug = slug;
    }
  }
  if (edit.blocks !== undefined) {
    const r = pageBlocksSchema.safeParse(edit.blocks);
    if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "Invalid blocks", { status: 400, code: "INVALID_INPUT" });
    data.blocks = json(r.data);
  }
  if (edit.seo !== undefined) {
    const r = pageSeoSchema.safeParse(edit.seo ?? {});
    if (!r.success) throw new AppError(r.error.issues[0]?.message ?? "Invalid SEO settings", { status: 400, code: "INVALID_INPUT" });
    data.seo = json(r.data);
  }
  try {
    const updated = await db.landingPage.update({ where: { id: page.id }, data });
    if (data.slug !== undefined && page.status === "published") {
      await log(a, "update", `Moved the published page "${updated.title}" from /${page.slug} to /${updated.slug}`);
    }
    return updated;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("Another page already uses that address.", { status: 409, code: "SLUG_TAKEN" });
    }
    throw e;
  }
}

/**
 * Blocks that point at a form or lead magnet must use one of this tenant's
 * that a visitor can actually reach (an active form, a published magnet).
 */
export async function referenceIssues(businessId: string, blocks: ParsedBlock[]): Promise<BlockIssue[]> {
  const formIds = blocks.filter((b) => b.blockKey === "lead-form").map((b) => String(b.props.formId));
  const magnetIds = blocks.filter((b) => b.blockKey === "lead-magnet").map((b) => String(b.props.magnetId));
  const [forms, magnets] = await Promise.all([
    formIds.length ? db.leadFormDef.findMany({ where: { businessId, id: { in: formIds }, status: "active" }, select: { id: true } }) : [],
    magnetIds.length ? db.leadMagnet.findMany({ where: { businessId, id: { in: magnetIds }, status: "published" }, select: { id: true } }) : [],
  ]);
  const okForms = new Set(forms.map((f) => f.id));
  const okMagnets = new Set(magnets.map((m) => m.id));
  const out: BlockIssue[] = [];
  blocks.forEach((b, index) => {
    if (b.blockKey === "lead-form" && !okForms.has(String(b.props.formId)))
      out.push({ blockId: b.id, blockKey: b.blockKey, index, messages: ["formId: The form was archived or deleted. Choose another."] });
    if (b.blockKey === "lead-magnet" && !okMagnets.has(String(b.props.magnetId)))
      out.push({ blockId: b.id, blockKey: b.blockKey, index, messages: ["magnetId: The lead magnet isn't published. Publish it in Leads → Lead magnets or choose another."] });
  });
  return out;
}

/** Put the draft live: every block must be valid, and the plan's page limit applies to newly published pages. */
export async function publishPage(a: Actor, id: string) {
  const page = await getPageOrThrow(a.businessId, id);
  const draft = readBlocks(page.blocks);
  const placeholders = findPlaceholders(draft);
  if (placeholders.length) {
    throw new AppError(
      `Replace ${placeholders.length === 1 ? "1 placeholder" : `${placeholders.length} placeholders`} with real details before publishing.`,
      { status: 400, code: "PLACEHOLDERS", details: { placeholders } }
    );
  }
  const validated = validateBlocks(draft);
  const { blocks } = validated;
  const issues = [...validated.issues, ...(await referenceIssues(a.businessId, validated.blocks))];
  if (issues.length) {
    throw new AppError(`Fix ${issues.length === 1 ? "1 block" : `${issues.length} blocks`} before publishing.`, { status: 400, code: "BLOCK_ISSUES", details: { issues } });
  }
  if (!blocks.length) throw new AppError("Add at least one block before publishing.", { status: 400, code: "EMPTY_PAGE" });
  if (page.status !== "published") await requireQuota(a.businessId, "pages");

  const seo = readPageSeo(page.seo);
  const [updated] = await db.$transaction([
    db.landingPage.update({ where: { id: page.id }, data: { status: "published", publishedAt: new Date(), publishedBlocks: json(blocks) } }),
    db.landingPageVersion.create({ data: { pageId: page.id, blocks: json(blocks), seo: json(seo), title: page.title, publishedBy: a.name } }),
  ]);
  await log(a, "publish", `Published the page "${page.title}" (/${page.slug})`);
  return updated;
}

export async function unpublishPage(a: Actor, id: string) {
  const page = await getPageOrThrow(a.businessId, id);
  if (page.status !== "published") return page;
  const updated = await db.landingPage.update({ where: { id: page.id }, data: { status: "draft" } });
  await log(a, "unpublish", `Unpublished the page "${page.title}" (/${page.slug})`);
  return updated;
}

export async function deletePage(a: Actor, id: string) {
  const page = await getPageOrThrow(a.businessId, id);
  await db.landingPage.delete({ where: { id: page.id } });
  await log(a, "delete", `Deleted the page "${page.title}" (/${page.slug})`);
}

/**
 * Put an earlier version live again (and make it the draft). Recorded as a
 * new version so the history shows what happened, and in the activity log.
 */
export async function restoreVersion(a: Actor, pageId: string, versionId: string) {
  const page = await getPageOrThrow(a.businessId, pageId);
  const version = await db.landingPageVersion.findFirst({ where: { id: versionId, pageId: page.id } });
  if (!version) throw new AppError("Version not found.", { status: 404, code: "NOT_FOUND" });
  const { blocks } = validateBlocks(readBlocks(version.blocks));
  const broken = await referenceIssues(a.businessId, blocks);
  if (broken.length) throw new AppError("That version uses a form or lead magnet that's no longer available.", { status: 400, code: "BLOCK_ISSUES", details: { issues: broken } });
  if (page.status !== "published") await requireQuota(a.businessId, "pages");
  const [updated] = await db.$transaction([
    db.landingPage.update({
      where: { id: page.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        title: version.title,
        blocks: json(blocks),
        publishedBlocks: json(blocks),
        seo: version.seo === null ? Prisma.DbNull : json(version.seo),
      },
    }),
    db.landingPageVersion.create({
      data: { pageId: page.id, blocks: json(blocks), seo: version.seo === null ? Prisma.DbNull : json(version.seo), title: version.title, publishedBy: a.name, restoredFrom: version.id },
    }),
  ]);
  await log(a, "restore", `Restored the page "${version.title}" (/${page.slug}) to the version from ${version.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, { versionId: version.id });
  return updated;
}
