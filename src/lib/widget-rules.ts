// Proactive widget messages and the pre-chat form (Phase 2, workstream O).
//
// Rules are stored per tenant and sent to the widget with its config. The
// widget picks the first enabled rule (highest priority) whose pages, visitor
// type and device match, waits for its trigger, then shows the message.
// The matcher runs in visitors' browsers, so it is written once as plain
// JavaScript (RULE_MATCHER_JS): widget.js embeds that source and the unit
// tests evaluate the same text.

import { z } from "zod";

export const MAX_RULES = 20;

const page = z.object({
  match: z.enum(["contains", "equals", "prefix"]),
  value: z.string().trim().min(1).max(300),
});

export const ruleConditionsSchema = z
  .object({
    pages: z.array(page).max(20).default([]),
    trigger: z.enum(["load", "time", "scroll", "exit"]).default("time"),
    seconds: z.number().int().min(0).max(600).optional(),
    scrollPercent: z.number().int().min(5).max(100).optional(),
    visitor: z.enum(["any", "new", "returning"]).default("any"),
    devices: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop", "mobile"]),
  })
  .transform((c) => ({
    ...c,
    // Only keep the setting the trigger uses, with a sensible default.
    seconds: c.trigger === "time" ? (c.seconds ?? 15) : undefined,
    scrollPercent: c.trigger === "scroll" ? (c.scrollPercent ?? 50) : undefined,
    devices: [...new Set(c.devices)],
  }));

export type RuleConditions = z.output<typeof ruleConditionsSchema>;

export const widgetRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(-100).max(100).default(0),
  conditions: ruleConditionsSchema,
  message: z.string().trim().min(1).max(300),
  quickReplies: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
  // booking: a bubble whose chat opens on the booking step (needs a booking type).
  action: z.enum(["bubble", "open", "booking"]).default("bubble"),
  frequency: z.enum(["session", "day", "once"]).default("session"),
});

export type WidgetRuleInput = z.output<typeof widgetRuleInputSchema>;

/** Stored JSON back to conditions; a malformed row never matches anything. */
export function readConditions(raw: unknown): RuleConditions | null {
  const parsed = ruleConditionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function readQuickReplies(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 4) : [];
}

export interface PublicRule {
  id: string;
  priority: number;
  conditions: RuleConditions;
  message: string;
  quickReplies: string[];
  action: "bubble" | "open" | "booking";
  frequency: "session" | "day" | "once";
}

/** What the widget receives: enabled, well-formed rules, best first. Counters stay private. */
export function toPublicRules(
  rows: { id: string; enabled: boolean; priority: number; conditions: unknown; message: string; quickReplies: unknown; action: string; frequency: string; createdAt: Date }[]
): PublicRule[] {
  return rows
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
    .flatMap((r) => {
      const conditions = readConditions(r.conditions);
      if (!conditions) return [];
      return [
        {
          id: r.id,
          priority: r.priority,
          conditions,
          message: r.message,
          quickReplies: readQuickReplies(r.quickReplies),
          action: r.action === "open" || r.action === "booking" ? r.action : "bubble",
          frequency: r.frequency === "day" || r.frequency === "once" ? r.frequency : "session",
        } satisfies PublicRule,
      ];
    });
}

/**
 * Plain-JS rule matcher shared by widget.js and the tests. Defines
 * `__dnPickRule(rules, ctx)`, where ctx = { path, returning, device,
 * capped(rule) }, and returns the first rule that matches, or null.
 * Pages compare against the path, case-insensitively, ignoring a trailing
 * slash for "equals"; an empty page list matches every page.
 */
export const RULE_MATCHER_JS = `
function __dnPathMatches(path, p){
  var v = String(p.value || '').toLowerCase().trim();
  var x = String(path || '/').toLowerCase();
  if (!v) return false;
  if (p.match === 'equals') { var a = x.replace(/\\/+$/, '') || '/'; var b = v.replace(/\\/+$/, '') || '/'; return a === b; }
  if (p.match === 'prefix') return x.indexOf(v) === 0;
  return x.indexOf(v) !== -1;
}
function __dnPickRule(rules, ctx){
  for (var i = 0; i < (rules || []).length; i++) {
    var r = rules[i], c = r.conditions || {};
    var pages = c.pages || [];
    if (pages.length && !pages.some(function(p){ return __dnPathMatches(ctx.path, p); })) continue;
    if (c.visitor === 'new' && ctx.returning) continue;
    if (c.visitor === 'returning' && !ctx.returning) continue;
    if (c.devices && c.devices.length && c.devices.indexOf(ctx.device) === -1) continue;
    if (ctx.capped && ctx.capped(r)) continue;
    return r;
  }
  return null;
}
`;

// ─── Pre-chat form ────────────────────────────────────────────────────

const fieldMode = z.enum(["off", "optional", "required"]);

export const preChatFormSchema = z
  .object({
    enabled: z.boolean().default(false),
    intro: z.string().trim().max(200).optional(),
    fields: z
      .object({
        email: fieldMode.default("required"),
        phone: fieldMode.default("optional"),
        company: fieldMode.default("off"),
      })
      .default({ email: "required", phone: "optional", company: "off" }),
    consentText: z.string().trim().max(300).optional(),
  })
  .refine((f) => !f.enabled || f.fields.email !== "off" || f.fields.phone !== "off", {
    message: "Ask for at least an email or a phone number.",
    path: ["fields"],
  });

export type PreChatForm = z.output<typeof preChatFormSchema>;

/** Stored JSON to the form, or null when it's off or malformed. */
export function readPreChatForm(raw: unknown): PreChatForm | null {
  const parsed = preChatFormSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.enabled) return null;
  const f = parsed.data;
  return { ...f, intro: f.intro || undefined, consentText: f.consentText || undefined };
}
