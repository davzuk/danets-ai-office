/**
 * Display labels and colours for lead sources / attribution channels.
 * Client-safe (no server imports); keep keys in sync with CHANNELS in
 * src/lib/attribution.ts and the Lead.source comment in schema.prisma.
 */
export const LEAD_SOURCE_META: Record<string, { label: string; color: string }> = {
  // Attribution channels
  organic_search: { label: "Organic search", color: "#16a34a" },
  paid_search: { label: "Paid search", color: "#ea580c" },
  social_organic: { label: "Social", color: "#db2777" },
  social_paid: { label: "Paid social", color: "#9333ea" },
  email: { label: "Email", color: "#06b6d4" },
  referral: { label: "Referral", color: "#8b5cf6" },
  direct: { label: "Direct", color: "#475569" },
  whatsapp: { label: "WhatsApp", color: "#84cc16" },
  // Capture methods (pre-attribution and manual entries)
  chatbot: { label: "Chatbot", color: "#1d4ed8" },
  website_form: { label: "Website form", color: "#0ea5e9" },
  manual: { label: "Manual", color: "#f59e0b" },
  social_media: { label: "Social media", color: "#db2777" },
};

export function leadSourceLabel(source: string): string {
  return LEAD_SOURCE_META[source]?.label ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function leadSourceColor(source: string): string {
  return LEAD_SOURCE_META[source]?.color ?? "#64748b";
}

export const TOUCH_KIND_LABEL: Record<string, string> = {
  visit: "Visited the site",
  chat_start: "Started a chat",
  form_submit: "Submitted their details",
  ad_lead: "Submitted an ad lead form",
  social_dm: "Sent a social message",
  email_click: "Clicked an email",
  booking: "Booked a meeting",
};
