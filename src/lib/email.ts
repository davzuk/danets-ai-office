import "server-only";
import { db } from "@/lib/db";

/**
 * Email Notification Service
 *
 * Sends email notifications to business users based on their notification preferences.
 * Supports SMTP (via Nodemailer) and SendGrid as providers.
 *
 * Environment variables:
 * EMAIL_PROVIDER=smtp | sendgrid | none
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=587
 * SMTP_USER=your@email.com
 * SMTP_PASS=your_app_password
 * SMTP_FROM=noreply@danetstecpro.com
 * SENDGRID_API_KEY=SG.xxx
 * SENDGRID_FROM=noreply@danetstecpro.com
 *
 * If no provider is configured, emails are logged but not sent (development mode).
 */

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailLogEntry {
  businessId: string;
  to: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  provider: string;
  error?: string;
  notificationType?: string;
}

const EMAIL_TEMPLATES: Record<
  string,
  { subject: string; buildHtml: (data: any) => string; buildText: (data: any) => string }
> = {
  new_lead: {
    subject: "New lead captured: {leadName}",
    buildHtml: (d) => emailTemplate(
      "New Lead Captured",
      `A new lead has been captured by your AI chatbot.`,
      [
        { label: "Lead Name", value: d.leadName || "N/A" },
        { label: "Quality", value: d.quality || "medium" },
        { label: "Service", value: d.service || "N/A" },
      ],
      "View Lead",
      "/leads"
    ),
    buildText: (d) => `New lead captured: ${d.leadName || "N/A"} (${d.quality || "medium"} quality, ${d.service || "N/A"}). View at /leads`,
  },
  high_quality_lead: {
    subject: "High quality lead captured! {leadName}",
    buildHtml: (d) => emailTemplate(
      "High Quality Lead! 🎯",
      `A high-quality lead has been captured — follow up promptly!`,
      [
        { label: "Lead Name", value: d.leadName || "N/A" },
        { label: "Quality", value: "High" },
        { label: "Service", value: d.service || "N/A" },
      ],
      "View Lead",
      "/leads"
    ),
    buildText: (d) => `High quality lead: ${d.leadName || "N/A"} (${d.service || "N/A"}). Follow up now at /leads`,
  },
  new_ticket: {
    subject: "New support ticket: {ticketSubject}",
    buildHtml: (d) => emailTemplate(
      "New Support Ticket",
      `A new support ticket has been created.`,
      [
        { label: "Subject", value: d.ticketSubject || "N/A" },
        { label: "Priority", value: d.priority || "medium" },
        { label: "Customer", value: d.customerName || "N/A" },
      ],
      "View Ticket",
      "/tickets"
    ),
    buildText: (d) => `New support ticket: ${d.ticketSubject || "N/A"} (${d.priority || "medium"} priority). View at /tickets`,
  },
  urgent_ticket: {
    subject: "URGENT ticket: {ticketSubject}",
    buildHtml: (d) => emailTemplate(
      "Urgent Ticket! ⚠️",
      `An urgent support ticket has been created — requires immediate attention!`,
      [
        { label: "Subject", value: d.ticketSubject || "N/A" },
        { label: "Priority", value: "Urgent" },
        { label: "Customer", value: d.customerName || "N/A" },
      ],
      "View Ticket",
      "/tickets"
    ),
    buildText: (d) => `URGENT ticket: ${d.ticketSubject || "N/A"}. View immediately at /tickets`,
  },
  proposal_accepted: {
    subject: "Proposal accepted! {clientName}",
    buildHtml: (d) => emailTemplate(
      "Proposal Accepted! 🎉",
      `Great news — your proposal has been accepted!`,
      [
        { label: "Client", value: d.clientName || "N/A" },
        { label: "Service", value: d.service || "N/A" },
      ],
      "View Proposal",
      "/quotes"
    ),
    buildText: (d) => `Proposal accepted by ${d.clientName || "N/A"} for ${d.service || "N/A"}. View at /quotes`,
  },
  ai_usage_warning: {
    subject: "AI usage at 80% — consider upgrading",
    buildHtml: (d) => emailTemplate(
      "AI Usage Warning ⚡",
      `You've used ${d.percentage || 80}% of your monthly AI request quota. Consider upgrading your plan to avoid interruptions.`,
      [
        { label: "Usage", value: `${d.percentage || 80}%` },
        { label: "Plan", value: d.planName || "current plan" },
      ],
      "Upgrade Plan",
      "/subscription"
    ),
    buildText: (d) => `AI usage at ${d.percentage || 80}%. Consider upgrading at /subscription`,
  },
  subscription_expiry: {
    subject: "Subscription expiring soon",
    buildHtml: (d) => emailTemplate(
      "Subscription Expiring ⏰",
      `Your subscription ${d.message || "is expiring soon"}. Renew now to keep your features active.`,
      [
        { label: "Plan", value: d.planName || "current plan" },
        { label: "Action", value: d.message || "Renew subscription" },
      ],
      "Manage Subscription",
      "/subscription"
    ),
    buildText: (d) => `Subscription expiring: ${d.message || "renew now"}. Manage at /subscription`,
  },
  payment_success: {
    subject: "Payment successful — {planName} plan activated",
    buildHtml: (d) => emailTemplate(
      "Payment Successful ✅",
      `Your payment of ${d.currency || "USD"} ${d.amount || "0.00"} was successful and your ${d.planName || ""} plan is now active.`,
      [
        { label: "Amount", value: `${d.currency || "USD"} ${d.amount || "0.00"}` },
        { label: "Plan", value: d.planName || "N/A" },
        { label: "Invoice", value: d.invoiceNumber || "N/A" },
      ],
      "View Invoices",
      "/subscription"
    ),
    buildText: (d) => `Payment of ${d.currency || "USD"} ${d.amount || "0.00"} for ${d.planName || ""} plan. Invoice: ${d.invoiceNumber || "N/A"}.`,
  },
};

function emailTemplate(
  title: string,
  message: string,
  details: { label: string; value: string }[],
  ctaLabel: string,
  ctaHref: string
): string {
  const rows = details
    .map(
      (d) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">${d.label}:</td><td style="padding:6px 0;font-weight:600;font-size:14px;">${d.value}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:20px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06);">
      <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);padding:24px 28px;color:#fff;">
        <div style="font-size:20px;font-weight:700;">Danets AI Automation</div>
        <div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Danets TecPro Limited</div>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">${title}</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6;">${message}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${rows}</table>
        <a href="${ctaHref}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px;">${ctaLabel} →</a>
      </div>
      <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">You're receiving this because you have email notifications enabled. Manage your preferences in Settings → Notification Preferences.</p>
      </div>
    </div>
  </div>
</body></html>`;
}

/**
 * Send an email notification to business users.
 * Checks each user's notification preferences before sending.
 */
export async function sendEmailNotification(
  businessId: string,
  type: string,
  data: Record<string, any>
): Promise<void> {
  try {
    const template = EMAIL_TEMPLATES[type];
    if (!template) {
      // No email template for this notification type
      return;
    }

    // Get all business users with email
    const users = await db.businessUser.findMany({
      where: { businessId, email: { not: undefined } },
      select: { id: true, email: true, name: true },
    });

    if (users.length === 0) return;

    // Check email provider configuration
    const provider = process.env.EMAIL_PROVIDER || "none";
    if (provider === "none") {
      // Development mode — log but don't send
      console.log(`[email] Skipped (no provider): type=${type} to=${users.length} users`);
      return;
    }

    const subject = template.subject
      .replace("{leadName}", data.leadName || "")
      .replace("{ticketSubject}", data.ticketSubject || "")
      .replace("{clientName}", data.clientName || data.proposalClientName || "")
      .replace("{planName}", data.planName || "");

    const html = template.buildHtml(data);
    const text = template.buildText(data);

    for (const user of users) {
      // Check user's email preference for this type
      const pref = await db.notificationPreference.findUnique({
        where: {
          businessId_userId_type: {
            businessId,
            userId: user.id,
            type,
          },
        },
      });

      // Default: email is off unless explicitly enabled
      if (pref && !pref.email) continue;
      if (!pref) continue; // email defaults to off

      await sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });
    }
  } catch (e) {
    console.error(`[email] sendEmailNotification failed for type=${type}:`, e);
  }
}

/**
 * Send a single email via the configured provider.
 * In production, this would use Nodemailer (SMTP) or SendGrid SDK.
 */
async function sendEmail(params: EmailParams): Promise<{ success: boolean; error?: string }> {
  const provider = process.env.EMAIL_PROVIDER || "none";
  const from =
    process.env.SMTP_FROM ||
    process.env.SENDGRID_FROM ||
    process.env.EMAIL_FROM ||
    "noreply@danetstecpro.com";

  try {
    if (provider === "smtp") {
      const host = process.env.SMTP_HOST;
      const port = parseInt(process.env.SMTP_PORT || "587", 10);
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!host || !user || !pass) {
        return { success: false, error: "SMTP_HOST, SMTP_USER, and SMTP_PASS are required" };
      }

      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { success: true };
    }

    if (provider === "sendgrid") {
      const apiKey = process.env.SENDGRID_API_KEY;
      if (!apiKey) {
        return { success: false, error: "SENDGRID_API_KEY is required" };
      }

      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.to }] }],
          from: { email: from },
          subject: params.subject,
          content: [
            ...(params.text
              ? [{ type: "text/plain", value: params.text }]
              : []),
            { type: "text/html", value: params.html },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { success: false, error: errText || `SendGrid error (${res.status})` };
      }
      return { success: true };
    }

    console.log(`[email] No provider — skipped: to=${params.to} subject="${params.subject}"`);
    return { success: false, error: "No email provider configured" };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}

/**
 * Send a test email to verify configuration.
 */
export async function sendTestEmail(to: string): Promise<{ success: boolean; message: string }> {
  const provider = process.env.EMAIL_PROVIDER || "none";

  if (provider === "none") {
    return {
      success: false,
      message:
        "No email provider configured. Set EMAIL_PROVIDER=smtp or sendgrid in your environment variables.",
    };
  }

  const result = await sendEmail({
    to,
    subject: "Danets AI Automation — Test Email",
    html: emailTemplate(
      "Test Email ✓",
      "This is a test email from Danets AI Automation. If you received this, your email configuration is working correctly!",
      [
        { label: "Provider", value: provider },
        { label: "Timestamp", value: new Date().toISOString() },
      ],
      "Go to Dashboard",
      "/"
    ),
    text: "Danets AI Automation test email. Your email configuration is working correctly.",
  });

  return {
    success: result.success,
    message: result.success
      ? "Test email sent successfully. Check your inbox."
      : `Failed to send: ${result.error}`,
  };
}
