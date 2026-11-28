import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { platformAiStatus } from "@/lib/platform-ai";

export const PLATFORM_CONFIG_ID = "default";

export interface PlatformConfigData {
  id: string;
  platformName: string;
  platformTagline: string;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultSignupPlan: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  emailFromName: string;
  emailFromAddress: string | null;
  allowPublicSignup: boolean;
  enforcePlatform2fa: boolean;
  updatedAt: string;
}

export type SetupCheckStatus = "ok" | "warning" | "error";

export interface SetupCheck {
  id: string;
  label: string;
  status: SetupCheckStatus;
  message: string;
  required: boolean;
}

export interface PlatformSetupStatus {
  ready: boolean;
  checks: SetupCheck[];
  summary: { ok: number; warning: number; error: number };
}

const DEFAULTS = {
  platformName: "Danets AI Automation",
  platformTagline: "AI-powered business automation",
  defaultSignupPlan: "free",
  emailFromName: "Danets AI",
  maintenanceMode: false,
  allowPublicSignup: true,
  enforcePlatform2fa: false,
};

function platformConfigDelegate() {
  return (db as unknown as { platformConfig?: { findUnique: Function; create: Function; update: Function } })
    .platformConfig;
}

function defaultConfig(): PlatformConfigData {
  return {
    id: PLATFORM_CONFIG_ID,
    platformName: DEFAULTS.platformName,
    platformTagline: DEFAULTS.platformTagline,
    supportEmail: null,
    supportPhone: null,
    defaultSignupPlan: DEFAULTS.defaultSignupPlan,
    maintenanceMode: DEFAULTS.maintenanceMode,
    maintenanceMessage: null,
    emailFromName: DEFAULTS.emailFromName,
    emailFromAddress: null,
    allowPublicSignup: DEFAULTS.allowPublicSignup,
    enforcePlatform2fa: DEFAULTS.enforcePlatform2fa,
    updatedAt: new Date().toISOString(),
  };
}

export async function getPlatformConfig(): Promise<PlatformConfigData> {
  const delegate = platformConfigDelegate();
  if (!delegate) {
    logger.warn(
      "platform-config: Prisma client is missing PlatformConfig — run `npx prisma generate && restart dev server`"
    );
    return defaultConfig();
  }

  let row = await delegate.findUnique({ where: { id: PLATFORM_CONFIG_ID } });
  if (!row) {
    row = await delegate.create({ data: { id: PLATFORM_CONFIG_ID } });
  }
  return serializeConfig(row);
}

export async function updatePlatformConfig(
  data: Partial<Omit<PlatformConfigData, "id" | "updatedAt">>
): Promise<PlatformConfigData> {
  const delegate = platformConfigDelegate();
  if (!delegate) {
    throw new Error("Platform config unavailable — run npx prisma generate and restart the server");
  }

  await getPlatformConfig();
  const row = await delegate.update({
    where: { id: PLATFORM_CONFIG_ID },
    data: {
      ...(data.platformName !== undefined && { platformName: data.platformName.trim() }),
      ...(data.platformTagline !== undefined && { platformTagline: data.platformTagline.trim() }),
      ...(data.supportEmail !== undefined && {
        supportEmail: data.supportEmail?.trim() || null,
      }),
      ...(data.supportPhone !== undefined && {
        supportPhone: data.supportPhone?.trim() || null,
      }),
      ...(data.defaultSignupPlan !== undefined && { defaultSignupPlan: data.defaultSignupPlan }),
      ...(data.maintenanceMode !== undefined && { maintenanceMode: data.maintenanceMode }),
      ...(data.maintenanceMessage !== undefined && {
        maintenanceMessage: data.maintenanceMessage?.trim() || null,
      }),
      ...(data.emailFromName !== undefined && { emailFromName: data.emailFromName.trim() }),
      ...(data.emailFromAddress !== undefined && {
        emailFromAddress: data.emailFromAddress?.trim() || null,
      }),
      ...(data.allowPublicSignup !== undefined && { allowPublicSignup: data.allowPublicSignup }),
      ...(data.enforcePlatform2fa !== undefined && { enforcePlatform2fa: data.enforcePlatform2fa }),
    },
  });
  return serializeConfig(row);
}

function serializeConfig(row: {
  id: string;
  platformName: string;
  platformTagline: string;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultSignupPlan: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  emailFromName: string;
  emailFromAddress: string | null;
  allowPublicSignup: boolean;
  enforcePlatform2fa: boolean;
  updatedAt: Date;
}): PlatformConfigData {
  return {
    id: row.id,
    platformName: row.platformName,
    platformTagline: row.platformTagline,
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    defaultSignupPlan: row.defaultSignupPlan,
    maintenanceMode: row.maintenanceMode,
    maintenanceMessage: row.maintenanceMessage,
    emailFromName: row.emailFromName,
    emailFromAddress: row.emailFromAddress,
    allowPublicSignup: row.allowPublicSignup,
    enforcePlatform2fa: row.enforcePlatform2fa,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function getEmailProviderInfo() {
  const provider = process.env.EMAIL_PROVIDER || "none";
  const fromEnv =
    process.env.SMTP_FROM || process.env.SENDGRID_FROM || process.env.RESEND_FROM || null;
  return {
    provider,
    configured: provider !== "none",
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: process.env.SMTP_PORT || null,
    smtpUser: process.env.SMTP_USER ? "••••••••" : null,
    sendgridConfigured: !!process.env.SENDGRID_API_KEY,
    fromEnv,
    paystackConfigured: !!process.env.PAYSTACK_SECRET_KEY,
    flutterwaveConfigured: !!process.env.FLUTTERWAVE_SECRET_HASH,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
  };
}

export async function getPlatformSetupStatus(): Promise<PlatformSetupStatus> {
  const config = await getPlatformConfig();
  const emailInfo = getEmailProviderInfo();
  const checks: SetupCheck[] = [];

  const planCount = await db.subscriptionPlan.count({ where: { isActive: true } });
  checks.push({
    id: "plans",
    label: "Subscription plans",
    status: planCount >= 4 ? "ok" : planCount > 0 ? "warning" : "error",
    message:
      planCount >= 4
        ? `${planCount} active plans configured`
        : planCount > 0
          ? `Only ${planCount} active plan(s) — seed or activate all tiers`
          : "No active plans — tenants cannot subscribe",
    required: true,
  });

  const adminCount = await db.platformAdmin.count();
  const adminsWithout2fa = await db.platformAdmin.count({ where: { totpEnabled: false } });
  checks.push({
    id: "platform_admins",
    label: "Platform administrators",
    status: adminCount > 0 ? "ok" : "error",
    message:
      adminCount > 0
        ? `${adminCount} platform admin account(s)`
        : "No platform admin — run seed or create an admin",
    required: true,
  });

  if (config.enforcePlatform2fa) {
    checks.push({
      id: "platform_2fa",
      label: "Platform 2FA enforcement",
      status: adminsWithout2fa === 0 ? "ok" : "error",
      message:
        adminsWithout2fa === 0
          ? "All platform admins have 2FA enabled"
          : `${adminsWithout2fa} admin(s) missing 2FA — enforcement is on`,
      required: true,
    });
  } else {
    checks.push({
      id: "platform_2fa",
      label: "Platform 2FA (recommended)",
      status: adminsWithout2fa === 0 ? "ok" : "warning",
      message:
        adminsWithout2fa === 0
          ? "All platform admins have 2FA enabled"
          : "Enable 2FA on platform admin accounts in Security tab",
      required: false,
    });
  }

  checks.push({
    id: "support_email",
    label: "Support contact email",
    status: config.supportEmail ? "ok" : "warning",
    message: config.supportEmail
      ? config.supportEmail
      : "Set support email in General settings",
    required: false,
  });

  const effectiveFrom = config.emailFromAddress || emailInfo.fromEnv;
  checks.push({
    id: "email_provider",
    label: "Email delivery",
    status: emailInfo.configured ? (effectiveFrom ? "ok" : "warning") : "warning",
    message: emailInfo.configured
      ? effectiveFrom
        ? `Provider: ${emailInfo.provider} · From: ${effectiveFrom}`
        : `Provider ${emailInfo.provider} set but no from-address configured`
      : "EMAIL_PROVIDER not set — emails logged only (dev mode)",
    required: false,
  });

  checks.push({
    id: "payment_paystack",
    label: "Paystack webhooks",
    status: emailInfo.paystackConfigured ? "ok" : "warning",
    message: emailInfo.paystackConfigured
      ? "PAYSTACK_SECRET_KEY configured"
      : "Set PAYSTACK_SECRET_KEY in production for payment verification",
    required: false,
  });

  checks.push({
    id: "payment_flutterwave",
    label: "Flutterwave webhooks",
    status: emailInfo.flutterwaveConfigured ? "ok" : "warning",
    message: emailInfo.flutterwaveConfigured
      ? "FLUTTERWAVE_SECRET_HASH configured"
      : "Set FLUTTERWAVE_SECRET_HASH in production for payment verification",
    required: false,
  });

  // Mirrors resolveProvider in src/lib/llm/resolve.ts: the AI set in
  // Platform settings first, then the env default.
  const env = process.env;
  const stored = await platformAiStatus();
  const aiDefault = env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  const aiProvider =
    aiDefault === "anthropic" || aiDefault === "openai" || aiDefault === "alibaba" || aiDefault === "zai"
      ? aiDefault
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : "zai";
  const aiReady =
    aiProvider === "anthropic"
      ? !!env.ANTHROPIC_API_KEY
      : aiProvider === "openai"
        ? !!(env.OPENAI_API_KEY && (env.OPENAI_DEFAULT_MODEL || env.AI_DEFAULT_MODEL))
        : aiProvider === "alibaba"
          ? !!env.ALIBABA_API_KEY
          : false;
  const envLabel = aiProvider === "anthropic" ? "Anthropic (Claude)" : aiProvider === "openai" ? "OpenAI" : "Alibaba Cloud (Qwen)";
  checks.push({
    id: "ai_provider",
    label: "AI provider",
    status: stored?.active || aiReady ? "ok" : "warning",
    message: stored?.active
      ? `Platform AI: ${stored.label} (set in the AI tab)`
      : stored
        ? "The AI tab's Alibaba Cloud key can't be read: enter it again"
        : aiReady
          ? `Platform default: ${envLabel}`
          : aiProvider === "openai"
            ? "AI_DEFAULT_PROVIDER=openai needs OPENAI_API_KEY and OPENAI_DEFAULT_MODEL; falling back to the built-in z-ai model"
            : "No platform AI key: AI features use the built-in z-ai model. Set one in the AI tab (tenants can also add their own key)",
    required: false,
  });

  const metaApp = !!(env.META_APP_ID && env.META_APP_SECRET);
  const metaWebhook = !!env.META_WEBHOOK_VERIFY_TOKEN;
  checks.push({
    id: "meta_app",
    label: "Meta app (Facebook & Instagram)",
    status: metaApp && metaWebhook ? "ok" : "warning",
    message: !metaApp
      ? "Set META_APP_ID and META_APP_SECRET to let tenants connect Pages, Instagram and Lead Ads"
      : !metaWebhook
        ? "Set META_WEBHOOK_VERIFY_TOKEN so Meta can verify the webhook (leads, DMs, comments)"
        : "App credentials and webhook verify token configured",
    required: false,
  });

  const linkedinApp = !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  checks.push({
    id: "linkedin_app",
    label: "LinkedIn app",
    status: linkedinApp ? "ok" : "warning",
    message: !linkedinApp
      ? "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to let tenants connect LinkedIn Pages for publishing and Lead Gen Forms"
      : env.LINKEDIN_LEAD_SYNC === "true"
        ? "App configured; Lead Gen Forms sync requested"
        : "App configured for publishing; set LINKEDIN_LEAD_SYNC=true once LinkedIn approves the Lead Sync API",
    required: false,
  });

  const storageDriver = (env.STORAGE_DRIVER || "local").toLowerCase();
  const s3Missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"].filter((k) => !env[k]);
  checks.push({
    id: "media_storage",
    label: "Media storage",
    status: storageDriver === "s3" ? (s3Missing.length ? "error" : "ok") : env.NODE_ENV === "production" ? "warning" : "ok",
    message:
      storageDriver === "s3"
        ? s3Missing.length
          ? `STORAGE_DRIVER=s3 is missing ${s3Missing.join(", ")}: uploads will fail`
          : `S3-compatible bucket, public at ${env.S3_PUBLIC_URL}`
        : env.NODE_ENV === "production"
          ? "Local disk: fine for one server with a persistent disk; use STORAGE_DRIVER=s3 for several instances"
          : "Local disk (development)",
    required: storageDriver === "s3",
  });

  const defaultPlan = await db.subscriptionPlan.findUnique({
    where: { name: config.defaultSignupPlan },
  });
  checks.push({
    id: "default_plan",
    label: "Default signup plan",
    status: defaultPlan?.isActive ? "ok" : "error",
    message: defaultPlan?.isActive
      ? `New tenants default to "${config.defaultSignupPlan}"`
      : `Default plan "${config.defaultSignupPlan}" is missing or inactive`,
    required: true,
  });

  const summary = {
    ok: checks.filter((c) => c.status === "ok").length,
    warning: checks.filter((c) => c.status === "warning").length,
    error: checks.filter((c) => c.status === "error").length,
  };

  const ready = checks.filter((c) => c.required).every((c) => c.status !== "error");

  return { ready, checks, summary };
}

export function getEffectiveEmailFrom(config: PlatformConfigData): string | null {
  return config.emailFromAddress || getEmailProviderInfo().fromEnv;
}
