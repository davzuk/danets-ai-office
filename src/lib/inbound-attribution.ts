import type { Touchpoint } from "@prisma/client";
import { db } from "@/lib/db";
import { logger, serializeError } from "@/lib/logger";
import {
  parseAttribution,
  recordTouch,
  recordVisits,
  type AttributionInput,
  type Channel,
  type TouchKind,
} from "@/lib/attribution";
import { contactTouchBounds, normalizeEmail, normalizePhone, resolveContact, type ContactProfile } from "@/lib/contacts";

export interface InboundArgs {
  businessId: string;
  kind: TouchKind;
  visitorId?: string | null;
  /** Raw `attribution` from the request body; validated here. */
  attribution?: unknown;
  profile?: ContactProfile;
  /**
   * "always": resolve/create a contact from any identity (lead capture).
   * "identified": create one only when an email or phone is known; otherwise
   * just link to an existing contact for this visitor (anonymous chats).
   */
  createContact?: "always" | "identified";
  /** Campaign of the form, lead magnet or booking type the event came through. */
  campaignId?: string | null;
}

export interface InboundResult {
  contactId: string | null;
  /** The touch recorded for this event (chat_start / form_submit / …). */
  touch: Touchpoint;
  /** Earliest touch known for this person (falls back to `touch`). */
  firstTouch: Touchpoint;
  /** True when we know more than "a form was submitted": UTM/referrer data or earlier visits. */
  attributed: boolean;
  /** Channel of the first touch, for Lead.source. */
  channel: Channel;
}

/**
 * Contact resolution + touchpoint recording for an inbound event from the
 * public widget. Best-effort by design: attribution must never block a lead
 * or a chat, so every failure is logged and swallowed (returns null).
 */
export async function captureInbound(args: InboundArgs): Promise<InboundResult | null> {
  try {
    const attribution: AttributionInput | null = parseAttribution(args.attribution);
    const visitorId = args.visitorId?.trim().slice(0, 191) || null;
    const identified = !!(normalizeEmail(args.profile?.email) || normalizePhone(args.profile?.phone));

    let contactId: string | null = null;
    if (args.createContact !== "identified" || identified) {
      const resolved = await resolveContact({
        businessId: args.businessId,
        identities: visitorId ? [{ type: "visitor", value: visitorId }] : [],
        profile: args.profile,
      });
      contactId = resolved?.contact.id ?? null;
    } else if (visitorId) {
      const known = await db.contactIdentity.findUnique({
        where: { businessId_type_value: { businessId: args.businessId, type: "visitor", value: visitorId } },
        select: { contactId: true },
      });
      contactId = known?.contactId ?? null;
      if (contactId) await db.contact.update({ where: { id: contactId }, data: { lastSeenAt: new Date() } });
    }

    if (attribution && visitorId) {
      await recordVisits({ businessId: args.businessId, visitorId, attribution, contactId });
    }
    const touch = await recordTouch({
      businessId: args.businessId,
      kind: args.kind,
      touch: attribution?.last ?? attribution?.first ?? null,
      visitorId,
      contactId,
      // An explicit campaign wins; otherwise recordTouch matches utm_campaign.
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    });

    let firstTouch = touch;
    if (contactId) {
      firstTouch = (await contactTouchBounds(contactId)).first ?? touch;
    } else if (visitorId) {
      firstTouch =
        (await db.touchpoint.findFirst({
          where: { businessId: args.businessId, visitorId },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        })) ?? touch;
    }

    return {
      contactId,
      touch,
      firstTouch,
      attributed: !!attribution || firstTouch.id !== touch.id,
      channel: firstTouch.channel as Channel,
    };
  } catch (e) {
    logger.warn("Inbound attribution failed; continuing without it", {
      businessId: args.businessId,
      kind: args.kind,
      ...serializeError(e),
    });
    return null;
  }
}
