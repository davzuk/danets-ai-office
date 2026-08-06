import "server-only";
import { decryptApiKey } from "@/lib/crypto";

export type IntegrationTestResult = {
  success: boolean;
  message: string;
  details?: string;
};

type IntegrationRecord = {
  category: string;
  provider: string;
  name: string;
  config: string | null;
};

function parseConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try {
    return JSON.parse(config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function testOpenAi(apiKey: string): Promise<IntegrationTestResult> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) {
    return { success: true, message: "OpenAI API key is valid." };
  }
  const body = await res.text().catch(() => "");
  return {
    success: false,
    message: "OpenAI API key rejected.",
    details: body.slice(0, 200) || `HTTP ${res.status}`,
  };
}

async function testSendGrid(apiKey: string): Promise<IntegrationTestResult> {
  const res = await fetch("https://api.sendgrid.com/v3/user/profile", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) {
    return { success: true, message: "SendGrid API key is valid." };
  }
  return {
    success: false,
    message: "SendGrid API key rejected.",
    details: `HTTP ${res.status}`,
  };
}

async function testSmtp(config: Record<string, unknown>): Promise<IntegrationTestResult> {
  const host = String(config.host || config.smtpHost || "");
  const user = String(config.user || config.smtpUser || "");
  const pass = String(config.pass || config.smtpPass || config.password || "");
  const port = parseInt(String(config.port || config.smtpPort || "587"), 10);

  if (!host || !user || !pass) {
    return {
      success: false,
      message: "SMTP config requires host, user, and password.",
    };
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.verify();
  return { success: true, message: "SMTP connection verified." };
}

async function testPaystack(secretKey: string): Promise<IntegrationTestResult> {
  const res = await fetch("https://api.paystack.co/balance", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.status) {
    return { success: true, message: "Paystack secret key is valid." };
  }
  return {
    success: false,
    message: data.message || "Paystack key rejected.",
    details: `HTTP ${res.status}`,
  };
}

async function testMetaWhatsApp(
  apiKey: string,
  phoneNumberId?: string
): Promise<IntegrationTestResult> {
  const url = phoneNumberId
    ? `https://graph.facebook.com/v21.0/${phoneNumberId}`
    : "https://graph.facebook.com/v21.0/me";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    return {
      success: true,
      message: phoneNumberId
        ? "Meta WhatsApp phone number ID is reachable."
        : "Meta API token is valid.",
    };
  }
  return {
    success: false,
    message: data?.error?.message || "Meta API token rejected.",
    details: `HTTP ${res.status}`,
  };
}

/** Run a real connectivity check for the given integration record. */
export async function testIntegrationConnection(
  integration: IntegrationRecord
): Promise<IntegrationTestResult> {
  const config = parseConfig(integration.config);
  // apiKey on disk is now an encrypted envelope (or legacy plaintext). The
  // decrypt helper returns null on shape mismatch so we can fall through to
  // the legacy-String path during the rollout window.
  const raw = config.apiKey;
  let apiKey = "";
  if (typeof raw === "string") {
    apiKey = raw; // legacy plaintext
  } else if (raw && typeof raw === "object" && (raw as any).__enc === 1) {
    apiKey = decryptApiKey(raw) || "";
  }

  switch (integration.category) {
    case "ai_provider": {
      if (integration.provider === "openai" && apiKey) return testOpenAi(apiKey);
      if (integration.provider === "manual") {
        return {
          success: true,
          message: "Manual AI provider — no remote check required.",
        };
      }
      return {
        success: false,
        message: "Add a valid API key to test this AI provider.",
      };
    }

    case "email": {
      if (integration.provider === "sendgrid" && apiKey) return testSendGrid(apiKey);
      if (integration.provider === "smtp") return testSmtp(config);
      if (integration.provider === "manual") {
        return {
          success: true,
          message: "Manual email — uses platform SMTP when configured.",
        };
      }
      return {
        success: false,
        message: "Email integration needs SMTP host/user/pass or a SendGrid API key.",
      };
    }

    case "payment": {
      if (integration.provider === "paystack" && apiKey) return testPaystack(apiKey);
      if (["flutterwave", "manual"].includes(integration.provider)) {
        return {
          success: true,
          message: `${integration.provider} payment — configure keys in environment variables.`,
        };
      }
      return {
        success: false,
        message: "Add a Paystack secret key in integration config to test.",
      };
    }

    case "whatsapp": {
      if (integration.provider === "meta" && apiKey) {
        return testMetaWhatsApp(
          apiKey,
          String(config.phoneNumberId || config.phone_number_id || "")
        );
      }
      if (integration.provider === "manual") {
        return {
          success: true,
          message: "Manual WhatsApp — use click-to-chat links from the dashboard.",
        };
      }
      return {
        success: false,
        message: "WhatsApp provider needs a Meta API access token to test.",
      };
    }

    case "website_widget":
    case "crm":
      return {
        success: true,
        message: `${integration.name} saved — no remote ping for this category.`,
      };

    case "sms":
      if (integration.provider === "twilio" && apiKey) {
        return {
          success: true,
          message: "Twilio credentials saved — full SMS ping not yet implemented.",
        };
      }
      return {
        success: false,
        message: "SMS integration needs provider credentials.",
      };

    default:
      return {
        success: false,
        message: `Unknown integration category: ${integration.category}`,
      };
  }
}
