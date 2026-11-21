import type { Contact, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Unified contacts: one Contact per person per tenant, found by any of its
 * identities (email, phone, widget visitor id, social platform ids).
 */

export const IDENTITY_TYPES = ["visitor", "email", "phone", "whatsapp", "fb_psid", "ig_id", "linkedin"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

/**
 * Identities that only prove "same browser", not "same person". A weak match
 * is ignored when the matched contact already has a different email, so a
 * shared computer doesn't merge two people.
 */
const WEAK_IDENTITIES = new Set<IdentityType>(["visitor"]);

export interface IdentityInput {
  type: IdentityType;
  value: string | null | undefined;
}

export interface ContactProfile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  return e && e.length <= 191 && EMAIL_RE.test(e) ? e : null;
}

/** "+44 (0)20 7946-0958" → "+4402079460958". Needs 7–15 digits (E.164 max). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (trimmed.startsWith("+") || trimmed.startsWith("00") ? "+" : "") + digits.replace(/^00/, "");
}

export function normalizeIdentity(i: IdentityInput): { type: IdentityType; value: string } | null {
  if (!i.value) return null;
  let value: string | null;
  switch (i.type) {
    case "email":
      value = normalizeEmail(i.value);
      break;
    case "phone":
    case "whatsapp":
      value = normalizePhone(i.value);
      break;
    default:
      value = i.value.trim().slice(0, 191) || null;
  }
  return value ? { type: i.type, value } : null;
}

/** Normalised, de-duplicated identities, including email/phone from the profile. */
export function collectIdentities(identities: IdentityInput[], profile: ContactProfile = {}) {
  const all = [...identities, { type: "email" as const, value: profile.email }, { type: "phone" as const, value: profile.phone }];
  const out = new Map<string, { type: IdentityType; value: string }>();
  for (const i of all) {
    const n = normalizeIdentity(i);
    if (n) out.set(`${n.type}:${n.value}`, n);
  }
  return [...out.values()];
}

/** Pick the profile value to keep: the survivor's, else the first non-empty one. */
export function mergeProfile(contacts: Pick<Contact, "name" | "email" | "phone" | "company">[], incoming: ContactProfile) {
  const pick = (k: "name" | "email" | "phone" | "company") => contacts.find((c) => c[k])?.[k] ?? incoming[k] ?? null;
  return { name: pick("name"), email: pick("email"), phone: pick("phone"), company: pick("company") };
}

export interface ResolveContactArgs {
  businessId: string;
  identities: IdentityInput[];
  profile?: ContactProfile;
  /** When this activity happened (defaults to now). The backfill passes the record's createdAt. */
  now?: Date;
}

export interface ResolveContactResult {
  contact: Contact;
  created: boolean;
  /** Contacts folded into `contact` because the identities linked them. */
  mergedIds: string[];
}

const RETRYABLE = new Set(["P2002", "P2034"]); // unique race, deadlock / write conflict

/**
 * Find-or-create the contact for a set of identities, in one transaction:
 * merges every contact the identities point at into the oldest one (re-pointing
 * leads, chats, tickets, quotes and touchpoints), fills blank profile fields,
 * adds new identities, and links earlier anonymous touchpoints and chats from
 * the contact's visitor ids. Returns null when no usable identity was given.
 */
export async function resolveContact(args: ResolveContactArgs): Promise<ResolveContactResult | null> {
  const profile: ContactProfile = {
    name: args.profile?.name?.trim().slice(0, 191) || null,
    email: normalizeEmail(args.profile?.email),
    phone: normalizePhone(args.profile?.phone),
    company: args.profile?.company?.trim().slice(0, 191) || null,
  };
  const identities = collectIdentities(args.identities, profile);
  if (identities.length === 0) return null;

  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction((tx) => resolveInTx(tx, args.businessId, identities, profile, args.now ?? new Date()));
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (attempt < 3 && code && RETRYABLE.has(code)) {
        logger.debug("resolveContact retry", { businessId: args.businessId, code, attempt });
        continue;
      }
      throw e;
    }
  }
}

async function resolveInTx(
  tx: Prisma.TransactionClient,
  businessId: string,
  identities: { type: IdentityType; value: string }[],
  profile: ContactProfile,
  now: Date
): Promise<ResolveContactResult> {
  const matched = await tx.contactIdentity.findMany({
    where: { businessId, OR: identities.map((i) => ({ type: i.type, value: i.value })) },
    select: { contactId: true, type: true, value: true },
  });
  const byEmail = profile.email
    ? await tx.contact.findMany({ where: { businessId, email: profile.email }, select: { id: true } })
    : [];

  const candidateIds = [...new Set([...matched.map((m) => m.contactId), ...byEmail.map((c) => c.id)])];
  let candidates = candidateIds.length
    ? await tx.contact.findMany({ where: { id: { in: candidateIds }, businessId }, orderBy: { createdAt: "asc" } })
    : [];

  // Drop contacts reached only through a weak identity whose email conflicts with ours.
  if (profile.email) {
    const strongIds = new Set(
      matched.filter((m) => !WEAK_IDENTITIES.has(m.type as IdentityType)).map((m) => m.contactId)
    );
    byEmail.forEach((c) => strongIds.add(c.id));
    candidates = candidates.filter((c) => strongIds.has(c.id) || !c.email || c.email === profile.email);
  }

  // Identities that already belong to a contact we're not merging stay where they are.
  const keptIds = new Set(candidates.map((c) => c.id));
  const ownedElsewhere = new Set(matched.filter((m) => !keptIds.has(m.contactId)).map((m) => `${m.type}:${m.value}`));
  const alreadyOwned = new Set(matched.filter((m) => keptIds.has(m.contactId)).map((m) => `${m.type}:${m.value}`));
  const toAdd = identities.filter((i) => !ownedElsewhere.has(`${i.type}:${i.value}`) && !alreadyOwned.has(`${i.type}:${i.value}`));

  if (candidates.length === 0) {
    const contact = await tx.contact.create({
      data: {
        businessId,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        company: profile.company,
        firstSeenAt: now,
        lastSeenAt: now,
        identities: { create: toAdd.map((i) => ({ businessId, type: i.type, value: i.value })) },
      },
    });
    await attachAnonymousActivity(tx, businessId, contact.id);
    return { contact, created: true, mergedIds: [] };
  }

  const [survivor, ...losers] = candidates;
  const loserIds = losers.map((c) => c.id);
  if (loserIds.length) {
    const repoint = { where: { contactId: { in: loserIds } }, data: { contactId: survivor.id } };
    await tx.contactIdentity.updateMany(repoint);
    await tx.touchpoint.updateMany(repoint);
    await tx.lead.updateMany(repoint);
    await tx.chatSession.updateMany(repoint);
    await tx.supportTicket.updateMany(repoint);
    await tx.quoteRequest.updateMany(repoint);
    // Delete before writing the survivor's email: (businessId, email) is unique.
    await tx.contact.deleteMany({ where: { id: { in: loserIds } } });
  }

  const merged = mergeProfile(candidates, profile);
  // Only ever widen the seen-window: the backfill replays old records with their own dates.
  const firstSeenAt = candidates.reduce((min, c) => (c.firstSeenAt < min ? c.firstSeenAt : min), now);
  const lastSeenAt = candidates.reduce((max, c) => (c.lastSeenAt > max ? c.lastSeenAt : max), now);
  const contact = await tx.contact.update({
    where: { id: survivor.id },
    data: {
      ...merged,
      firstSeenAt,
      lastSeenAt,
      consent: (survivor.consent ?? losers.find((l) => l.consent)?.consent ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  if (toAdd.length) {
    await tx.contactIdentity.createMany({
      data: toAdd.map((i) => ({ businessId, contactId: contact.id, type: i.type, value: i.value })),
    });
  }
  await attachAnonymousActivity(tx, businessId, contact.id);
  if (loserIds.length) logger.info("Contacts merged", { businessId, survivorId: contact.id, mergedIds: loserIds });
  return { contact, created: false, mergedIds: loserIds };
}

/** Link touchpoints and chat sessions recorded under the contact's visitor ids before we knew who they were. */
async function attachAnonymousActivity(tx: Prisma.TransactionClient, businessId: string, contactId: string) {
  const visitors = await tx.contactIdentity.findMany({
    where: { contactId, type: "visitor" },
    select: { value: true },
  });
  if (!visitors.length) return;
  const visitorId = { in: visitors.map((v) => v.value) };
  await tx.touchpoint.updateMany({ where: { businessId, visitorId, contactId: null }, data: { contactId } });
  await tx.chatSession.updateMany({ where: { businessId, visitorId, contactId: null }, data: { contactId } });
}

/** Earliest and latest touchpoints for a contact (lead first/last touch). */
export async function contactTouchBounds(contactId: string) {
  const [first, last] = await Promise.all([
    db.touchpoint.findFirst({ where: { contactId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    db.touchpoint.findFirst({ where: { contactId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] }),
  ]);
  return { first, last };
}
