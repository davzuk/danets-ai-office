import "server-only";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/activity";
import { logger, serializeError } from "@/lib/logger";
import { sendBookingLinkEmail } from "@/lib/booking/link-email";

/**
 * Automation Execution Engine
 *
 * Checks for active workflows matching a trigger type and executes their actions.
 * Actions are internal (tasks, notifications, notes, status changes), with
 * one exception: "send_booking_link" emails the lead a link to book a time.
 * Nothing else sends external messages automatically.
 *
 * Usage: call `fireTrigger("new_lead", { businessId, leadId, lead }) from
 * any route where a trigger event occurs.
 */

export interface TriggerContext {
  businessId: string;
  leadId?: string;
  leadName?: string;
  ticketId?: string;
  ticketSubject?: string;
  proposalId?: string;
  proposalClientName?: string;
  documentId?: string;
  documentTitle?: string;
  [key: string]: unknown;
}

/**
 * Fire a trigger — find all active workflows matching this trigger type
 * for the business, then execute each one's action.
 */
export async function fireTrigger(
  triggerType: string,
  ctx: TriggerContext
): Promise<void> {
  try {
    const workflows = await db.automationWorkflow.findMany({
      where: {
        businessId: ctx.businessId,
        triggerType,
        isActive: true,
      },
    });

    for (const wf of workflows) {
      if (!triggerConfigMatches(triggerType, parseConfig(wf.triggerConfig), ctx)) continue;
      await executeWorkflow(wf, ctx);
    }
  } catch (e) {
    // Never let automation errors break the parent operation
    logger.error("fireTrigger failed", {
      businessId: ctx.businessId,
      triggerType,
      ...serializeError(e),
    });
  }
}

async function executeWorkflow(
  workflow: {
    id: string;
    businessId: string;
    name: string;
    triggerType: string;
    triggerConfig: string | null;
    actionType: string;
    actionConfig: string | null;
  },
  ctx: TriggerContext
): Promise<void> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let status: "success" | "error" = "success";
  let errorMsg: string | null = null;
  let actionData: Record<string, unknown> = {};

  try {
    const actionConfig = parseConfig(workflow.actionConfig);
    actionData = await executeAction(workflow.actionType, actionConfig, workflow.businessId, ctx);
  } catch (e: any) {
    status = "error";
    errorMsg = e?.message || String(e);
  }

  // Log the run + bump the workflow's runCount atomically. Without the
  // transaction a crash between the two leaves the row count out of sync
  // with the run history.
  await db.$transaction([
    db.automationRun.create({
      data: {
        workflowId: workflow.id,
        businessId: workflow.businessId,
        triggerData: safeStringify({ triggerType: workflow.triggerType, ...ctx }),
        actionData: safeStringify(actionData),
        status,
        error: errorMsg,
      },
    }),
    db.automationWorkflow.update({
      where: { id: workflow.id },
      data: {
        runCount: { increment: 1 },
        lastRunAt: new Date(),
      },
    }),
  ]);
}

async function executeAction(
  actionType: string,
  config: Record<string, any>,
  businessId: string,
  ctx: TriggerContext
): Promise<Record<string, unknown>> {
  switch (actionType) {
    case "create_task": {
      const title = config.taskTitle || `Follow up on ${ctx.leadName || ctx.ticketSubject || "new item"}`;
      if (ctx.leadId) {
        await db.leadTask.create({
          data: {
            leadId: ctx.leadId,
            businessId,
            title,
            description: `Auto-created by automation: ${config.taskTitle || "triggered task"}`,
          },
        });
      }
      return { action: "create_task", title };
    }

    case "send_notification": {
      const notifType = config.notificationType || "new_lead";
      const title = getNotificationTitle(notifType, ctx);
      const message = getNotificationMessage(notifType, ctx);
      await createNotification({
        businessId,
        type: notifType,
        title,
        message,
        data: { leadId: ctx.leadId, ticketId: ctx.ticketId, automationTriggered: true },
      });
      return { action: "send_notification", type: notifType, title };
    }

    case "generate_ai_followup": {
      // Create a lead note with a placeholder — the admin can generate the actual
      // AI draft from the lead detail or WhatsApp view. This avoids expensive AI
      // calls during automation.
      if (ctx.leadId) {
        await db.leadNote.create({
          data: {
            leadId: ctx.leadId,
            businessId,
            authorName: "Automation",
            content: `[Auto-note] AI follow-up draft requested. Generate it from the WhatsApp → AI Follow-up Generator or the Lead detail → AI tab. Trigger: ${ctx.leadName || "lead"}`,
          },
        });
      }
      return { action: "generate_ai_followup", leadId: ctx.leadId };
    }

    case "add_lead_note": {
      if (ctx.leadId) {
        const content = config.noteContent || `Automated note: trigger fired for ${ctx.leadName || "lead"}`;
        await db.leadNote.create({
          data: {
            leadId: ctx.leadId,
            businessId,
            authorName: "Automation",
            content,
          },
        });
      }
      return { action: "add_lead_note", leadId: ctx.leadId };
    }

    case "change_lead_status": {
      if (ctx.leadId && config.leadStatus) {
        await db.lead.update({
          where: { id: ctx.leadId },
          data: { status: config.leadStatus },
        });
        await db.leadActivity.create({
          data: {
            leadId: ctx.leadId,
            businessId,
            type: "status_change",
            description: `Status changed to "${config.leadStatus}" by automation`,
            actorName: "Automation",
          },
        });
      }
      return { action: "change_lead_status", leadId: ctx.leadId, newStatus: config.leadStatus };
    }

    case "create_ticket": {
      if (ctx.leadId) {
        const lead = await db.lead.findUnique({
          where: { id: ctx.leadId },
          select: { name: true, email: true, phone: true, service: true, message: true },
        });
        if (lead) {
          const ticket = await db.supportTicket.create({
            data: {
              businessId,
              subject: `Follow-up ticket for ${lead.name}`,
              description: lead.message || `Auto-created ticket for lead ${lead.name} (${lead.service || "N/A"})`,
              priority: "medium",
              customerName: lead.name,
              customerEmail: lead.email,
              customerPhone: lead.phone,
            },
          });
          await db.supportTicketMessage.create({
            data: {
              ticketId: ticket.id,
              role: "customer",
              content: lead.message || "Converted from lead by automation",
              authorName: lead.name,
            },
          });
          return { action: "create_ticket", ticketId: ticket.id };
        }
      }
      return { action: "create_ticket", skipped: true };
    }

    case "create_proposal_reminder": {
      if (ctx.proposalId) {
        await db.proposalFollowup.create({
          data: {
            quoteRequestId: ctx.proposalId,
            businessId,
            type: "note",
            content: `[Auto-reminder] Follow up on proposal for ${ctx.proposalClientName || "client"}. Proposal was accepted — start onboarding.`,
            createdByName: "Automation",
          },
        });
      }
      return { action: "create_proposal_reminder", proposalId: ctx.proposalId };
    }

    case "send_booking_link": {
      if (!ctx.leadId) return { action: "send_booking_link", skipped: "no lead" };
      const result = await sendBookingLinkEmail(businessId, ctx.leadId, {
        bookingTypeSlug: typeof config.bookingTypeSlug === "string" ? config.bookingTypeSlug : undefined,
        message: typeof config.message === "string" ? config.message : undefined,
      });
      if (!result.sent) return { action: "send_booking_link", leadId: ctx.leadId, skipped: result.reason };
      return { action: "send_booking_link", leadId: ctx.leadId, to: result.to, url: result.url };
    }

    default:
      return { action: actionType, skipped: "unknown action" };
  }
}

/** Whether a workflow's trigger settings narrow it out of this event (e.g. "only for this form"). */
export function triggerConfigMatches(triggerType: string, cfg: Record<string, unknown>, ctx: TriggerContext): boolean {
  if (triggerType === "form_submitted" && typeof cfg.formId === "string" && cfg.formId) return cfg.formId === ctx.formId;
  return true;
}

function parseConfig(configStr: string | null): Record<string, any> {
  if (!configStr) return {};
  try {
    return JSON.parse(configStr);
  } catch {
    return {};
  }
}

/**
 * Safe JSON stringify that strips `__proto__`, `constructor`, and prototype
 * pollution payloads. Anything we persist as JSON must go through here so a
 * compromised workflow config can't smuggle in a payload that pollutes the
 * prototype chain when the JSON is later read back.
 */
function safeStringify(value: unknown): string {
  return JSON.stringify(sanitizeJson(value));
}

function sanitizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeJson);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = sanitizeJson(v);
  }
  return out;
}

function getNotificationTitle(type: string, ctx: TriggerContext): string {
  switch (type) {
    case "new_lead":
      return "New lead captured (auto)";
    case "new_ticket":
      return "New support ticket (auto)";
    case "urgent_ticket":
      return "Urgent ticket created (auto)";
    case "proposal_accepted":
      return "Proposal accepted! 🎉 (auto)";
    case "high_quality_lead":
      return "High quality lead! (auto)";
    case "follow_up_reminder":
      return "Follow-up reminder (auto)";
    case "booking_created":
      return "New booking (auto)";
    case "form_submitted":
      return "Form submitted (auto)";
    case "booking_cancelled":
      return "Booking cancelled (auto)";
    default:
      return `Automation notification (${type})`;
  }
}

function getNotificationMessage(type: string, ctx: TriggerContext): string {
  switch (type) {
    case "new_lead":
    case "high_quality_lead":
    case "booking_created":
    case "booking_cancelled":
    case "form_submitted":
      return `Automation triggered for lead: ${ctx.leadName || "Unknown"}`;
    case "new_ticket":
    case "urgent_ticket":
      return `Automation triggered for ticket: ${ctx.ticketSubject || "Unknown"}`;
    case "proposal_accepted":
      return `Automation triggered for proposal: ${ctx.proposalClientName || "Unknown"}`;
    default:
      return `Automation triggered: ${type}`;
  }
}
