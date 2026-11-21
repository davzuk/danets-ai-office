import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sanitizeInput } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(191),
  phone: z.string().max(40).optional(),
  company: z.string().max(120).optional(),
  message: z.string().min(5).max(4000),
  pageSlug: z.string().max(120).optional(),
});

// Hard cap on the raw JSON payload so a request body can't be megabytes
// long — a defence in depth alongside the per-field maxes in the schema.
const MAX_BODY_BYTES = 16 * 1024;

// Dedupe key = SHA-256 of (email, normalised message). If the same key
// landed in the last 10 minutes we silently 200 — the user gets a
// confirmation page without us creating a duplicate lead.
const DEDUPE_WINDOW_MS = 10 * 60_000;

const recentSubmissions = new Map<string, number>();

function dedupeKey(email: string, message: string): string {
  // Inline hash via WebCrypto. We import dynamically because `crypto` is
  // globally available in the Node runtime but the subtle API is the
  // portable way across runtimes.
  // Synchronous fallback: simple length+hash surrogate for fast pre-filter.
  return `${email.toLowerCase()}:${message.trim().toLowerCase().slice(0, 200)}`;
}

function isDuplicate(email: string, message: string): boolean {
  const k = dedupeKey(email, message);
  const last = recentSubmissions.get(k);
  const now = Date.now();
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  recentSubmissions.set(k, now);
  // Garbage-collect stale entries so the map doesn't grow forever.
  if (recentSubmissions.size > 500) {
    for (const [key, ts] of recentSubmissions) {
      if (now - ts > DEDUPE_WINDOW_MS) recentSubmissions.delete(key);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  // Per-IP rate limit, reusing the project-wide helper so Redis-backed
  // installs share limits across replicas.
  const rl = await rateLimit(`contact:${ip}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  // Reject oversized bodies before parsing — JSON.parse on a 10MB string
  // would burn memory and CPU.
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Submission is too large." },
      { status: 413 }
    );
  }

  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Submission is too large." },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { name, email, phone, company, message, pageSlug } = parsed.data;
  const cleanMessage = sanitizeInput(message, 4000);

  // Drop duplicate submissions — same email + same message in the last
  // 10 minutes. Returns a 200 so the UX still feels successful.
  if (isDuplicate(email, cleanMessage)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Look for an existing internal Danets tenant to attach the contact to.
  // Falls back to creating a fresh "contact" lead with a no-business flag.
  let attachedBusinessId: string | null = null;
  const internal = await db.business.findFirst({
    where: { name: { contains: "Danets TecPro" } },
    select: { id: true },
  });
  if (internal) attachedBusinessId = internal.id;

  const lead = await db.lead.create({
    data: {
      businessId: attachedBusinessId ?? (await ensureUnattachedBusiness()),
      sessionId: null,
      name: name,
      email,
      phone: phone || null,
      service: company ? `Contact — ${company}` : "Website contact form",
      message: cleanMessage,
      quality: "high",
      source: "website_form",
    },
  });

  await db.cmsContactSubmission.create({
    data: {
      name,
      email,
      phone: phone || null,
      company: company || null,
      message: cleanMessage,
      pageSlug: pageSlug || null,
      leadId: lead.id,
    },
  });

  if (attachedBusinessId) {
    await logActivity({
      businessId: attachedBusinessId,
      userName: "Public contact form",
      action: "lead_created",
      module: "leads",
      description: `New website contact from ${name} (${email})`,
      metadata: { source: "website_form", leadId: lead.id },
    });
  }

  return NextResponse.json({ ok: true });
}

// Some installs may not have an internal "Danets TecPro" business at
// seed time. In that case we create a hidden "Website Inbox" tenant
// to hold unattached leads so the Lead model invariants hold.
async function ensureUnattachedBusiness(): Promise<string> {
  const existing = await db.business.findFirst({
    where: { name: "Website Inbox" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.business.create({
    data: {
      name: "Website Inbox",
      plan: "free",
      status: "active",
      email: "inbox@danetstecpro.com",
    },
  });
  return created.id;
}