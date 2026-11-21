import { db } from "@/lib/db";
import { resolveContact, type IdentityInput } from "@/lib/contacts";

/**
 * Link existing leads, chat sessions, tickets and quotes to unified Contacts.
 * Idempotent: only rows with contactId = null are visited, and resolveContact
 * reuses contacts by identity, so a second run creates nothing new. Rows with
 * no usable identity (no email, phone or visitor id) are left unlinked.
 */

export interface BackfillStats {
  scanned: number;
  linked: number;
  skipped: number;
  contactsCreated: number;
}

type Row = { id: string; businessId: string; createdAt: Date };

const empty = (): BackfillStats => ({ scanned: 0, linked: 0, skipped: 0, contactsCreated: 0 });

async function backfillTable<T extends Row>(opts: {
  batchSize: number;
  fetch: (afterId: string | undefined, take: number) => Promise<T[]>;
  identify: (row: T) => { identities: IdentityInput[]; profile: { name?: string | null; email?: string | null; phone?: string | null; company?: string | null } };
  link: (row: T, contactId: string) => Promise<unknown>;
}): Promise<BackfillStats> {
  const stats = empty();
  let afterId: string | undefined;
  for (;;) {
    const rows = await opts.fetch(afterId, opts.batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      stats.scanned++;
      const { identities, profile } = opts.identify(row);
      const resolved = await resolveContact({ businessId: row.businessId, identities, profile, now: row.createdAt });
      if (!resolved) {
        stats.skipped++;
        continue;
      }
      if (resolved.created) stats.contactsCreated++;
      await opts.link(row, resolved.contact.id);
      stats.linked++;
    }
    afterId = rows[rows.length - 1].id;
  }
  return stats;
}

export async function backfillContacts(opts: { businessId?: string; batchSize?: number } = {}) {
  const batchSize = opts.batchSize ?? 200;
  const scope = opts.businessId ? { businessId: opts.businessId } : {};
  // Keyset paging on id. (Not Prisma's cursor + skip: 1, which would skip a
  // real row once the cursor row was linked and fell out of the filter.)
  const page = (afterId: string | undefined, take: number) => ({ orderBy: { id: "asc" as const }, take });
  const after = (afterId: string | undefined) => (afterId ? { id: { gt: afterId } } : {});

  const leads = await backfillTable({
    batchSize,
    fetch: (afterId, take) =>
      db.lead.findMany({
        where: { ...scope, ...after(afterId), contactId: null },
        select: { id: true, businessId: true, createdAt: true, name: true, email: true, phone: true, company: true, session: { select: { visitorId: true } } },
        ...page(afterId, take),
      }),
    identify: (l) => ({
      identities: l.session?.visitorId ? [{ type: "visitor", value: l.session.visitorId }] : [],
      profile: { name: l.name, email: l.email, phone: l.phone, company: l.company },
    }),
    link: (l, contactId) => db.lead.update({ where: { id: l.id }, data: { contactId } }),
  });

  // Anonymous chats (no email/phone) are only linked through a lead's visitor id above.
  const chatSessions = await backfillTable({
    batchSize,
    fetch: (afterId, take) =>
      db.chatSession.findMany({
        where: { ...scope, ...after(afterId), contactId: null, OR: [{ visitorEmail: { not: null } }, { visitorPhone: { not: null } }] },
        select: { id: true, businessId: true, createdAt: true, visitorId: true, visitorName: true, visitorEmail: true, visitorPhone: true },
        ...page(afterId, take),
      }),
    identify: (c) => ({
      identities: c.visitorId ? [{ type: "visitor", value: c.visitorId }] : [],
      profile: { name: c.visitorName, email: c.visitorEmail, phone: c.visitorPhone },
    }),
    link: (c, contactId) => db.chatSession.update({ where: { id: c.id }, data: { contactId } }),
  });

  const supportTickets = await backfillTable({
    batchSize,
    fetch: (afterId, take) =>
      db.supportTicket.findMany({
        where: { ...scope, ...after(afterId), contactId: null, OR: [{ customerEmail: { not: null } }, { customerPhone: { not: null } }] },
        select: { id: true, businessId: true, createdAt: true, customerName: true, customerEmail: true, customerPhone: true },
        ...page(afterId, take),
      }),
    identify: (t) => ({ identities: [], profile: { name: t.customerName, email: t.customerEmail, phone: t.customerPhone } }),
    link: (t, contactId) => db.supportTicket.update({ where: { id: t.id }, data: { contactId } }),
  });

  const quoteRequests = await backfillTable({
    batchSize,
    fetch: (afterId, take) =>
      db.quoteRequest.findMany({
        where: { ...scope, ...after(afterId), contactId: null, acceptedByEmail: { not: null } },
        select: { id: true, businessId: true, createdAt: true, clientName: true, companyName: true, acceptedByName: true, acceptedByEmail: true },
        ...page(afterId, take),
      }),
    identify: (q) => ({
      identities: [],
      profile: { name: q.acceptedByName || q.clientName, email: q.acceptedByEmail, company: q.companyName },
    }),
    link: (q, contactId) => db.quoteRequest.update({ where: { id: q.id }, data: { contactId } }),
  });

  return { leads, chatSessions, supportTickets, quoteRequests };
}
