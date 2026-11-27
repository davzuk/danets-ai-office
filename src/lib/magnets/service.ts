import "server-only";
// Lead magnets (Phase 2, workstream T): a PDF a visitor gets by email after
// filling in a gate form. Tenants upload a PDF or have the AI write one.
// Files live in storage under an unguessable key and are only handed out
// through signed links (see ./link.ts).

import { randomBytes } from "node:crypto";
import { Prisma, type LeadMagnet } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { getStorage, readLocalFile } from "@/lib/storage";
import { LimitExceededError, formatLimitExceededMessage, requireQuota } from "@/lib/plan-quota";
import { fireTrigger } from "@/lib/automation";
import { sendEmail } from "@/lib/email";
import { appOrigin } from "@/lib/public-cors";
import { layout, subjectSafe, text } from "@/lib/booking/emails";
import { logger, serializeError } from "@/lib/logger";
import { normalizeFields } from "@/lib/forms/schema";
import { loadPublicForm, type PublicForm } from "@/lib/forms/public";
import { magnetContentSchema, readContent, MAGNET_STYLES, type MagnetStyle } from "./content";
import { renderMagnetPdf } from "./pdf";
import { magnetLinkParams, verifyMagnetLink, LINK_TTL_MS } from "./link";

export const MAX_MAGNET_BYTES = 10 * 1024 * 1024;

const notFound = () => new AppError("Lead magnet not found.", { status: 404, code: "NOT_FOUND" });
const bad = (msg: string, code = "INVALID_INPUT") => new AppError(msg, { status: 400, code });

export interface DeliveryEmail {
  subject: string | null;
  intro: string | null;
}

export function readDelivery(raw: unknown): DeliveryEmail {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  return { subject: str(o.subject, 150), intro: str(o.intro, 1000) };
}

function readBullets(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((b): b is string => typeof b === "string" && !!b.trim())
        .map((b) => b.trim().slice(0, 200))
        .slice(0, 6)
    : [];
}

/** The AI style is kept inside content so the PDF can be re-rendered the same way. */
function readStyle(raw: unknown): MagnetStyle {
  const st = (raw as { style?: unknown } | null)?.style;
  return MAGNET_STYLES.includes(st as MagnetStyle) ? (st as MagnetStyle) : "checklist";
}

type WithForm = LeadMagnet & { form?: { id: string; name: string; status: string } | null };

export function toMagnetDto(m: WithForm) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    bullets: readBullets(m.bullets),
    kind: m.kind,
    style: m.kind === "ai" ? readStyle(m.content) : null,
    content: m.kind === "ai" ? readContent(m.content) : null,
    hasFile: !!m.fileKey,
    fileName: m.fileName,
    fileBytes: m.fileBytes,
    formId: m.formId,
    form: m.form ?? null,
    deliveryEmail: readDelivery(m.deliveryEmail),
    downloads: m.downloads,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export async function listMagnets(businessId: string) {
  const rows = await db.leadMagnet.findMany({
    where: { businessId },
    include: { form: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db.formSubmission.groupBy({ by: ["leadMagnetId"], where: { businessId, leadMagnetId: { in: ids }, status: "accepted" }, _count: { _all: true } })
    : [];
  const byId = new Map(counts.map((c) => [c.leadMagnetId, c._count._all]));
  return rows.map((r) => ({ ...toMagnetDto(r), signups: byId.get(r.id) ?? 0 }));
}

export async function getMagnet(businessId: string, id: string) {
  const m = await db.leadMagnet.findFirst({ where: { id, businessId }, include: { form: { select: { id: true, name: true, status: true } } } });
  if (!m) throw notFound();
  return m;
}

async function checkForm(businessId: string, formId: string) {
  const form = await db.leadFormDef.findFirst({ where: { id: formId, businessId } });
  if (!form) throw bad("Choose one of your forms as the gate.", "INVALID_FORM");
  return form;
}

/** The download link is emailed, so the gate must require an email address. */
export function formCollectsEmail(fields: unknown): boolean {
  return normalizeFields(fields).fields.some((f) => f.mapTo === "email" && f.required);
}

function parseContent(raw: unknown) {
  const parsed = magnetContentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw bad(issue ? `Check the document (${issue.path.join(".") || "content"}): ${issue.message}` : "Check the document.");
  }
  return parsed.data;
}

export async function createMagnet(
  businessId: string,
  input: { title?: unknown; kind?: unknown; description?: unknown; bullets?: unknown; content?: unknown; style?: unknown; formId?: unknown }
) {
  try {
    await requireQuota(businessId, "leadMagnets");
  } catch (e) {
    if (e instanceof LimitExceededError) throw new AppError(formatLimitExceededMessage(e), { status: 429, code: "LIMIT_EXCEEDED" });
    throw e;
  }
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
  if (!title) throw bad("Give the lead magnet a title.");
  const kind = input.kind === "ai" ? "ai" : "upload";
  let content: Prisma.InputJsonValue | undefined;
  if (kind === "ai") {
    const style = MAGNET_STYLES.includes(input.style as MagnetStyle) ? (input.style as MagnetStyle) : "checklist";
    content = { ...parseContent(input.content), style } as unknown as Prisma.InputJsonValue;
  }
  const formId = typeof input.formId === "string" && input.formId ? (await checkForm(businessId, input.formId)).id : null;
  const created = await db.leadMagnet.create({
    data: {
      businessId,
      title,
      kind,
      description: typeof input.description === "string" ? input.description.trim().slice(0, 1000) || null : null,
      bullets: readBullets(input.bullets),
      content,
      formId,
    },
  });
  if (kind === "ai") await renderAiFile(created);
  return getMagnet(businessId, created.id);
}

export async function updateMagnet(
  businessId: string,
  id: string,
  input: { title?: unknown; description?: unknown; bullets?: unknown; formId?: unknown; deliveryEmail?: unknown; content?: unknown; style?: unknown; status?: unknown }
) {
  const m = await getMagnet(businessId, id);
  const data: Prisma.LeadMagnetUpdateInput = {};
  if (input.title !== undefined) {
    const t = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
    if (!t) throw bad("Give the lead magnet a title.");
    data.title = t;
  }
  if (input.description !== undefined) data.description = typeof input.description === "string" ? input.description.trim().slice(0, 1000) || null : null;
  if (input.bullets !== undefined) data.bullets = readBullets(input.bullets);
  if (input.deliveryEmail !== undefined) data.deliveryEmail = readDelivery(input.deliveryEmail) as unknown as Prisma.InputJsonValue;
  if (input.formId !== undefined) {
    data.form = typeof input.formId === "string" && input.formId ? { connect: { id: (await checkForm(businessId, input.formId)).id } } : { disconnect: true };
  }
  let rerender = false;
  if (input.content !== undefined || input.style !== undefined) {
    if (m.kind !== "ai") throw bad("Only AI-written lead magnets have editable content.");
    const content = parseContent(input.content ?? readContent(m.content));
    const style = MAGNET_STYLES.includes(input.style as MagnetStyle) ? (input.style as MagnetStyle) : readStyle(m.content);
    data.content = { ...content, style } as unknown as Prisma.InputJsonValue;
    rerender = true;
  }
  if (input.status !== undefined) {
    if (input.status !== "draft" && input.status !== "published") throw bad("Unknown status.");
    data.status = input.status;
  }

  const updated = await db.leadMagnet.update({ where: { id: m.id }, data });
  // The title is printed in the PDF too.
  if (rerender || (m.kind === "ai" && data.title !== undefined && data.title !== m.title)) await renderAiFile(updated);
  const fresh = await getMagnet(businessId, id);
  if (fresh.status === "published") await assertPublishable(fresh);
  return fresh;
}

/** Reasons a magnet can't be published yet (empty when it can). */
export async function publishProblems(m: LeadMagnet): Promise<string[]> {
  const out: string[] = [];
  if (!m.fileKey) out.push(m.kind === "ai" ? "The PDF hasn't been generated." : "Upload the PDF.");
  if (!m.formId) out.push("Choose a gate form.");
  else {
    const form = await db.leadFormDef.findFirst({ where: { id: m.formId, businessId: m.businessId } });
    if (!form || form.status !== "active") out.push("The gate form is archived.");
    else if (!formCollectsEmail(form.fields)) out.push("The gate form needs a required field mapped to Email, so the download link can be sent.");
  }
  return out;
}

async function assertPublishable(m: LeadMagnet) {
  const problems = await publishProblems(m);
  if (problems.length) {
    await db.leadMagnet.update({ where: { id: m.id }, data: { status: "draft" } });
    throw new AppError(`Saved as a draft. ${problems.join(" ")}`, { status: 409, code: "NOT_PUBLISHABLE" });
  }
}

function newFileKey(businessId: string) {
  const d = new Date();
  return `${businessId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/lm_${randomBytes(16).toString("hex")}.pdf`;
}

async function storeFile(m: LeadMagnet, buf: Buffer, fileName: string) {
  const storage = getStorage();
  const key = newFileKey(m.businessId);
  await storage.put(key, buf, "application/pdf");
  await db.leadMagnet.update({ where: { id: m.id }, data: { fileKey: key, fileName, fileBytes: buf.length } });
  if (m.fileKey) await storage.delete(m.fileKey).catch((e) => logger.warn("Old lead magnet file not deleted", { key: m.fileKey, ...serializeError(e) }));
}

export function safeFileName(title: string) {
  return (
    title
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "download"
  ) + ".pdf";
}

/** Check and store an uploaded PDF. */
export async function uploadMagnetFile(businessId: string, id: string, buf: Buffer, originalName: string) {
  const m = await getMagnet(businessId, id);
  if (m.kind !== "upload") throw bad("This lead magnet's PDF is generated from its content.");
  if (buf.length === 0) throw bad("The file is empty.");
  if (buf.length > MAX_MAGNET_BYTES) throw bad("PDFs can be up to 10 MB.", "FILE_TOO_LARGE");
  // Trust the bytes, not the name or the browser's type.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw bad("Only PDF files can be used as lead magnets.", "NOT_PDF");
  await storeFile(m, buf, safeFileName(originalName.replace(/\.pdf$/i, "") || m.title));
  return getMagnet(businessId, id);
}

async function accentFor(businessId: string) {
  const agent = await db.aiAgent.findFirst({ where: { businessId }, select: { brandColor: true }, orderBy: { createdAt: "asc" } });
  const c = agent?.brandColor ?? "";
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#1d4ed8";
}

async function renderAiFile(m: LeadMagnet) {
  const content = readContent(m.content);
  if (!content) return;
  const [business, accent] = await Promise.all([db.business.findUnique({ where: { id: m.businessId }, select: { name: true } }), accentFor(m.businessId)]);
  const buf = await renderMagnetPdf({ title: m.title, businessName: business?.name ?? "", accent, style: readStyle(m.content), content });
  await storeFile(m, buf, safeFileName(m.title));
}

export async function deleteMagnet(businessId: string, id: string) {
  const m = await getMagnet(businessId, id);
  await db.leadMagnet.delete({ where: { id: m.id } });
  if (m.fileKey) await getStorage().delete(m.fileKey).catch((e) => logger.warn("Lead magnet file not deleted", { key: m.fileKey, ...serializeError(e) }));
  return m;
}

/** The file's bytes (local storage) or its storage URL (S3: objects there are public, under an unguessable key). */
export async function magnetFile(m: Pick<LeadMagnet, "fileKey">): Promise<{ body: Buffer } | { redirect: string } | null> {
  if (!m.fileKey) return null;
  const storage = getStorage();
  if (storage.name === "local") {
    const body = await readLocalFile(m.fileKey);
    return body ? { body } : null;
  }
  return { redirect: storage.publicUrl(m.fileKey) };
}

// ─── Public side ────────────────────────────────────────────────────

export interface PublicMagnet {
  id: string;
  title: string;
  description: string | null;
  bullets: string[];
  form: PublicForm;
}

/** A published magnet whose gate form a visitor can submit; null otherwise. */
export async function loadPublicMagnet(id: string) {
  if (!id || id.length > 40) return null;
  const m = await db.leadMagnet.findUnique({ where: { id } });
  if (!m || m.status !== "published" || !m.formId || !m.fileKey) return null;
  const loaded = await loadPublicForm(m.formId);
  if (!loaded || loaded.business.id !== m.businessId) return null;
  const pub: PublicMagnet = { id: m.id, title: m.title, description: m.description, bullets: readBullets(m.bullets), form: loaded.public };
  return { magnet: m, loaded, public: pub };
}

export function magnetDownloadUrl(magnetId: string, submissionId: string, now = Date.now()) {
  const url = new URL("/api/public/magnets/download", appOrigin());
  for (const [k, v] of Object.entries(magnetLinkParams(magnetId, submissionId, now))) url.searchParams.set(k, v);
  return url.toString();
}

/** Email the download link after a gate submission. Transactional: the visitor asked for it. */
export async function sendMagnetEmail(m: LeadMagnet, submission: { id: string; leadId: string | null }, to: string, name: string | null) {
  const business = await db.business.findUnique({ where: { id: m.businessId }, select: { name: true } });
  const businessName = business?.name ?? "";
  const url = magnetDownloadUrl(m.id, submission.id);
  const d = readDelivery(m.deliveryEmail);
  const firstName = (name ?? "").trim().split(/\s+/)[0] || "there";
  const intro = d.intro || `Hi ${firstName}, thanks for your interest. Here is your copy of "${m.title}".`;
  const days = Math.round(LINK_TTL_MS / 86_400_000);
  const footer = `Sent on behalf of ${businessName} because you asked for this download. The link works for ${days} days.`;
  const result = await sendEmail({
    to,
    subject: subjectSafe(d.subject || `Your download: ${m.title}`),
    html: layout(m.title, intro, [], { label: "Download the PDF", href: url }, footer),
    text: text(m.title, intro, [], `Download the PDF: ${url}\n\n${footer}`),
  });
  if (!result.success) logger.warn("Lead magnet email not sent", { magnetId: m.id, error: result.error });
  if (submission.leadId) {
    await db.leadActivity.create({
      data: {
        leadId: submission.leadId,
        businessId: m.businessId,
        type: "lead_magnet",
        description: result.success
          ? `Requested the lead magnet "${m.title}" (download link emailed)`
          : `Requested the lead magnet "${m.title}" (the email could not be sent)`,
        metadata: JSON.stringify({ leadMagnetId: m.id, submissionId: submission.id }),
      },
    });
  }
  return result.success;
}

export type DownloadResult =
  | { ok: true; magnet: LeadMagnet; file: { body: Buffer } | { redirect: string } }
  | { ok: false; status: 404 | 410; message: string };

const GONE = "This download isn't available any more.";

/** Check a download link, count the download and return the file. */
export async function downloadFromLink(q: { m?: string | null; s?: string | null; e?: string | null; sig?: string | null }): Promise<DownloadResult> {
  const check = verifyMagnetLink(q);
  if (!check.ok) {
    return check.reason === "expired"
      ? { ok: false, status: 410, message: "This download link has expired. Fill in the form again to get a new one." }
      : { ok: false, status: 404, message: "This download link isn't valid." };
  }
  const { magnetId, submissionId } = check.link;
  const [m, sub] = await Promise.all([
    db.leadMagnet.findUnique({ where: { id: magnetId } }),
    db.formSubmission.findUnique({ where: { id: submissionId }, select: { id: true, businessId: true, leadId: true, leadMagnetId: true, status: true } }),
  ]);
  if (!m || !sub || sub.leadMagnetId !== m.id || sub.businessId !== m.businessId || sub.status !== "accepted") return { ok: false, status: 404, message: GONE };
  const business = await db.business.findUnique({ where: { id: m.businessId }, select: { status: true } });
  if (business?.status !== "active") return { ok: false, status: 404, message: GONE };
  const file = await magnetFile(m);
  if (!file) return { ok: false, status: 404, message: GONE };

  await db.leadMagnet.update({ where: { id: m.id }, data: { downloads: { increment: 1 } } });
  // The first download of each request starts automations; repeat clicks don't.
  const first = await db.formSubmission.updateMany({ where: { id: sub.id, magnetDownloadedAt: null }, data: { magnetDownloadedAt: new Date() } });
  if (first.count && sub.leadId) {
    await db.leadActivity.create({
      data: { leadId: sub.leadId, businessId: m.businessId, type: "lead_magnet", description: `Downloaded the lead magnet "${m.title}"`, metadata: JSON.stringify({ leadMagnetId: m.id }) },
    });
    const lead = await db.lead.findUnique({ where: { id: sub.leadId }, select: { name: true } });
    await fireTrigger("lead_magnet_downloaded", { businessId: m.businessId, leadId: sub.leadId, leadName: lead?.name, leadMagnetId: m.id });
  }
  return { ok: true, magnet: m, file };
}
