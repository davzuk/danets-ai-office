"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Cpu,
  MessageCircle,
  Mail,
  Smartphone,
  CreditCard,
  Webhook,
  Code2,
  Loader2,
  RefreshCw,
  Trash2,
  Save,
  Settings,
  ShieldCheck,
  KeyRound,
  Plug,
  Check,
  Info,
  Phone,
  Send,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ConnectedAccounts } from "./connected-accounts";

// ─── Types ────────────────────────────────────────────────────────────

interface IntegrationsUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

type Category =
  | "ai_provider"
  | "whatsapp"
  | "email"
  | "sms"
  | "payment"
  | "crm"
  | "website_widget";

type Status = "active" | "inactive" | "testing" | "error";

interface IntegrationConfig {
  apiKeyMasked?: string | null;
  hasApiKey?: boolean;
  webhookUrl?: string;
  phoneNumber?: string;
  fromEmail?: string;
  smtpHost?: string;
  senderId?: string;
  model?: string;
  [k: string]: unknown;
}

interface Integration {
  id: string;
  category: Category;
  provider: string;
  name: string;
  status: Status;
  config: IntegrationConfig | null;
  lastTestedAt: string | null;
  notes: string | null;
  createdAt: string;
}

// ─── Category configuration ───────────────────────────────────────────

interface CategoryConfig {
  icon: LucideIcon;
  label: string;
  description: string;
  iconBg: string;
  iconText: string;
  builtIn?: boolean;
}

const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  ai_provider: {
    icon: Cpu,
    label: "AI Provider",
    description: "AI model used for chat, drafts, and document Q&A.",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  whatsapp: {
    icon: MessageCircle,
    label: "WhatsApp",
    description: "Send follow-ups and templates via WhatsApp.",
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-600 dark:text-emerald-400",
  },
  email: {
    icon: Mail,
    label: "Email",
    description: "Transactional email delivery provider.",
    iconBg: "bg-blue-500/15",
    iconText: "text-blue-600 dark:text-blue-400",
  },
  sms: {
    icon: Smartphone,
    label: "SMS",
    description: "SMS gateway for text notifications.",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  payment: {
    icon: CreditCard,
    label: "Payment",
    description: "Online payment and invoice collection.",
    iconBg: "bg-rose-500/15",
    iconText: "text-rose-600 dark:text-rose-400",
  },
  crm: {
    icon: Webhook,
    label: "CRM",
    description: "Push leads and events to your CRM.",
    iconBg: "bg-cyan-500/15",
    iconText: "text-cyan-600 dark:text-cyan-400",
  },
  website_widget: {
    icon: Code2,
    label: "Website Widget",
    description: "Danets chatbot widget embedded on your site.",
    iconBg: "bg-primary/15",
    iconText: "text-primary",
    builtIn: true,
  },
};

const CATEGORIES: Category[] = [
  "ai_provider",
  "whatsapp",
  "email",
  "sms",
  "payment",
  "crm",
  "website_widget",
];

// ─── Provider options per category ────────────────────────────────────

interface ProviderOption {
  value: string;
  label: string;
  needsApiKey: boolean;
}

const PROVIDER_OPTIONS: Record<Category, ProviderOption[]> = {
  ai_provider: [
    { value: "zai", label: "ZAI", needsApiKey: false },
    { value: "openai", label: "OpenAI", needsApiKey: true },
    { value: "anthropic", label: "Anthropic", needsApiKey: true },
    { value: "other", label: "Other", needsApiKey: true },
  ],
  whatsapp: [
    { value: "manual", label: "Manual Link", needsApiKey: false },
    { value: "meta_cloud_api", label: "Meta Cloud API", needsApiKey: true },
    { value: "twilio", label: "Twilio", needsApiKey: true },
    { value: "termii", label: "Termii", needsApiKey: true },
  ],
  email: [
    { value: "smtp", label: "SMTP", needsApiKey: true },
    { value: "sendgrid", label: "SendGrid", needsApiKey: true },
    { value: "mailgun", label: "Mailgun", needsApiKey: true },
    { value: "other", label: "Other", needsApiKey: true },
  ],
  sms: [
    { value: "twilio", label: "Twilio", needsApiKey: true },
    { value: "termii", label: "Termii", needsApiKey: true },
    { value: "other", label: "Other", needsApiKey: true },
  ],
  payment: [
    { value: "paystack", label: "Paystack", needsApiKey: true },
    { value: "flutterwave", label: "Flutterwave", needsApiKey: true },
    { value: "bank_transfer", label: "Bank Transfer", needsApiKey: false },
    { value: "manual", label: "Manual", needsApiKey: false },
  ],
  crm: [
    { value: "webhook", label: "Webhook", needsApiKey: false },
    { value: "custom", label: "Custom", needsApiKey: false },
  ],
  website_widget: [
    { value: "danets_widget", label: "Danets Widget (built-in)", needsApiKey: false },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function providerLabel(category: Category, value: string): string {
  const opt = PROVIDER_OPTIONS[category]?.find((o) => o.value === value);
  return opt?.label || value;
}

// ─── Status badge ─────────────────────────────────────────────────────

function StatusBadge({ status, builtIn }: { status: Status; builtIn?: boolean }) {
  if (builtIn) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 gap-1">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Built-in · Active
      </Badge>
    );
  }
  switch (status) {
    case "active":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Active
        </Badge>
      );
    case "testing":
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Testing
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20 gap-1">
          <span className="size-1.5 rounded-full bg-rose-500" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          Inactive
        </Badge>
      );
  }
}

// ─── Category Card ────────────────────────────────────────────────────

function CategoryCard({
  category,
  integration,
  onConfigure,
}: {
  category: Category;
  integration?: Integration;
  onConfigure: () => void;
}) {
  const cfg = CATEGORY_CONFIG[category];
  const Icon = cfg.icon;
  const isBuiltIn = !!cfg.builtIn;
  const provider = integration?.provider;
  const providerText = isBuiltIn
    ? "Danets Widget"
    : provider
      ? providerLabel(category, provider)
      : "Not configured";

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow hover:shadow-md flex flex-col",
        integration?.status === "active" && !isBuiltIn && "border-emerald-500/30",
        isBuiltIn && "border-primary/30"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("size-10 rounded-lg flex items-center justify-center", cfg.iconBg)}>
              <Icon className={cn("size-5", cfg.iconText)} />
            </div>
            <div>
              <CardTitle className="text-base leading-tight">{cfg.label}</CardTitle>
              <CardDescription className="text-xs mt-0.5 line-clamp-1">
                {cfg.description}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Provider
          </div>
          <div
            className={cn(
              "text-sm font-medium truncate",
              !provider && !isBuiltIn && "text-muted-foreground italic"
            )}
          >
            {providerText}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <StatusBadge
            status={integration?.status ?? "inactive"}
            builtIn={isBuiltIn}
          />
          {integration?.lastTestedAt ? (
            <span className="text-[11px] text-muted-foreground">
              Tested {formatRelativeTime(integration.lastTestedAt)}
            </span>
          ) : null}
        </div>

        <Separator />

        <Button
          variant={isBuiltIn ? "outline" : "default"}
          className="w-full"
          onClick={onConfigure}
        >
          <Settings className="size-4" />
          {isBuiltIn ? "View Embed Code" : "Configure"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Config Dialog ────────────────────────────────────────────────────

interface ConfigDialogProps {
  category: Category;
  integration?: Integration;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (integration: Integration) => void;
  onDeleted: (id: string) => void;
  userEmail?: string;
}

function ConfigDialog({
  category,
  integration,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
  userEmail,
}: ConfigDialogProps) {
  const cfg = CATEGORY_CONFIG[category];
  const options = PROVIDER_OPTIONS[category];

  const [provider, setProvider] = useState<string>(integration?.provider ?? options[0].value);
  const [apiKey, setApiKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(integration?.config?.webhookUrl ?? "");
  const [phoneNumber, setPhoneNumber] = useState(integration?.config?.phoneNumber ?? "");
  const [fromEmail, setFromEmail] = useState(integration?.config?.fromEmail ?? "");
  const [smtpHost, setSmtpHost] = useState(integration?.config?.smtpHost ?? "");
  const [senderId, setSenderId] = useState(integration?.config?.senderId ?? "");
  const [model, setModel] = useState(integration?.config?.model ?? "");
  const [notes, setNotes] = useState(integration?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testEmail, setTestEmail] = useState(userEmail ?? "");
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  // Reset state whenever the dialog opens (re-seed from integration).
  useEffect(() => {
    if (!open) return;
    setProvider(integration?.provider ?? options[0].value);
    setApiKey("");
    setWebhookUrl(integration?.config?.webhookUrl ?? "");
    setPhoneNumber(integration?.config?.phoneNumber ?? "");
    setFromEmail(integration?.config?.fromEmail ?? "");
    setSmtpHost(integration?.config?.smtpHost ?? "");
    setSenderId(integration?.config?.senderId ?? "");
    setModel(integration?.config?.model ?? "");
    setNotes(integration?.notes ?? "");
    setTestEmail(userEmail ?? "");
    setSendingTestEmail(false);
  }, [open, category, integration?.id, userEmail]);

  const providerOpt = options.find((o) => o.value === provider);
  const needsApiKey = !!providerOpt?.needsApiKey;
  const hasApiKey = !!integration?.config?.hasApiKey;

  // Category-specific field visibility
  const showPhone = category === "whatsapp";
  const showFromEmail = category === "email";
  const showSmtpHost = category === "email" && provider === "smtp";
  const showSenderId = category === "sms";
  const showWebhook = category === "crm" || (category === "whatsapp" && provider !== "manual");
  const showModel = category === "ai_provider";

  function buildConfig(): Record<string, unknown> | undefined {
    const c: Record<string, unknown> = {};
    if (apiKey.trim()) c.apiKey = apiKey.trim();
    if (showWebhook) c.webhookUrl = webhookUrl.trim();
    if (showPhone) c.phoneNumber = phoneNumber.trim();
    if (showFromEmail) c.fromEmail = fromEmail.trim();
    if (showSmtpHost) c.smtpHost = smtpHost.trim();
    if (showSenderId) c.senderId = senderId.trim();
    if (showModel && model.trim()) c.model = model.trim();
    return c;
  }

  async function handleSave() {
    if (!provider) {
      toast.error("Please select a provider");
      return;
    }
    setSaving(true);
    try {
      const config = buildConfig();
      const payload: Record<string, unknown> = {
        category,
        provider,
        name: providerLabel(category, provider),
        status: integration?.status === "active" ? "active" : "inactive",
        config,
        notes: notes.trim() || null,
      };
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save integration");

      // Refetch to get the masked config back
      const listRes = await fetch("/api/integrations", { method: "GET" });
      const listData = await listRes.json();
      const fresh = (listData.integrations as Integration[])?.find(
        (i) => i.category === category
      );
      if (fresh) onSaved(fresh);

      toast.success("Integration saved", {
        description: `${cfg.label} configured with ${providerLabel(category, provider)}.`,
      });
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error("Save failed", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!integration) {
      toast.error("Save the integration first to test the connection.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");

      onSaved({
        ...integration,
        status: "active",
        lastTestedAt: data.lastTestedAt ?? new Date().toISOString(),
      });
      toast.success("Connection test passed", {
        description: data.message || `${cfg.label} is now marked as active.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Test failed";
      toast.error("Connection test failed", { description: msg });
      onSaved({ ...integration, status: "error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!integration) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      onDeleted(integration.id);
      toast.success("Integration removed", {
        description: `${cfg.label} configuration has been deleted.`,
      });
      setDeleteOpen(false);
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error("Delete failed", { description: msg });
    } finally {
      setDeleting(false);
    }
  }

  async function handleSendTestEmail() {
    const email = testEmail.trim();
    if (!email) {
      toast.error("Enter an email address to send the test to.");
      return;
    }
    setSendingTestEmail(true);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test email failed");
      if (data.success) {
        toast.success("Test email sent", { description: data.message });
      } else {
        toast.error("Test email failed", { description: data.message });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Test email failed";
      toast.error("Test email failed", { description: msg });
    } finally {
      setSendingTestEmail(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={cn("size-7 rounded-md flex items-center justify-center", cfg.iconBg)}>
              <cfg.icon className={cn("size-4", cfg.iconText)} />
            </div>
            Configure {cfg.label}
          </DialogTitle>
          <DialogDescription>{cfg.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="int-provider">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="int-provider">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key */}
          {needsApiKey ? (
            <div className="space-y-2">
              <Label htmlFor="int-apikey" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" />
                API Key
              </Label>
              <Input
                id="int-apikey"
                type="password"
                autoComplete="off"
                placeholder={
                  hasApiKey
                    ? "•••••••• (stored)"
                    : "Paste your API key"
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {hasApiKey ? (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    A key is already stored
                    {integration?.config?.apiKeyMasked ? (
                      <> — <code className="font-mono">{integration.config.apiKeyMasked}</code></>
                    ) : null}
                    . Enter a new key to replace it.
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Stored server-side only — never exposed to the frontend.
                </p>
              )}
            </div>
          ) : null}

          {/* WhatsApp / Phone */}
          {showPhone ? (
            <div className="space-y-2">
              <Label htmlFor="int-phone" className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                Phone Number
              </Label>
              <Input
                id="int-phone"
                type="tel"
                placeholder="+234 801 234 5678"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Business WhatsApp number in international format.
              </p>
            </div>
          ) : null}

          {/* Email / From Email */}
          {showFromEmail ? (
            <div className="space-y-2">
              <Label htmlFor="int-fromemail" className="flex items-center gap-1.5">
                <Mail className="size-3.5" />
                From Email
              </Label>
              <Input
                id="int-fromemail"
                type="email"
                placeholder="noreply@yourbusiness.com"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
          ) : null}

          {/* Email SMTP / Host */}
          {showSmtpHost ? (
            <div className="space-y-2">
              <Label htmlFor="int-smtphost">SMTP Host</Label>
              <Input
                id="int-smtphost"
                placeholder="smtp.gmail.com:587"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Include the port (e.g. <code className="font-mono">:587</code> for TLS).
              </p>
            </div>
          ) : null}

          {/* SMS / Sender ID */}
          {showSenderId ? (
            <div className="space-y-2">
              <Label htmlFor="int-senderid">Sender ID</Label>
              <Input
                id="int-senderid"
                placeholder="DANETS"
                maxLength={11}
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Up to 11 characters; shown as the sender on outbound SMS.
              </p>
            </div>
          ) : null}

          {/* Webhook URL (CRM + WhatsApp non-manual) */}
          {showWebhook ? (
            <div className="space-y-2">
              <Label htmlFor="int-webhook" className="flex items-center gap-1.5">
                <Webhook className="size-3.5" />
                Webhook URL
              </Label>
              <Input
                id="int-webhook"
                type="url"
                placeholder="https://api.example.com/webhooks/danets"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {category === "crm"
                  ? "Danets will POST lead and event payloads to this URL."
                  : "Inbound webhook URL for delivery receipts and replies."}
              </p>
            </div>
          ) : null}

          {/* AI / Model */}
          {showModel ? (
            <div className="space-y-2">
              <Label htmlFor="int-model">Model <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="int-model"
                placeholder={provider === "anthropic" ? "e.g. claude-opus-5-5" : "Model name"}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {provider === "openai"
                  ? "Required for OpenAI — without it the platform default AI is used."
                  : "Leave blank to use the server default for this provider."}
              </p>
            </div>
          ) : null}

          <Separator />

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="int-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="int-notes"
              rows={3}
              maxLength={2000}
              placeholder="Internal notes — account ID, who to contact, expiry date, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground text-right">
              {notes.length}/2000
            </p>
          </div>

          {/* Status / Last tested summary */}
          {integration ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground">Current status</div>
                <StatusBadge status={integration.status} />
              </div>
              {integration.lastTestedAt ? (
                <div className="text-right space-y-0.5">
                  <div className="text-xs text-muted-foreground">Last tested</div>
                  <div className="text-xs font-medium">
                    {formatRelativeTime(integration.lastTestedAt)}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">Not tested yet</div>
              )}
            </div>
          ) : (
            <Alert className="border-primary/20 bg-primary/5">
              <Info className="size-4 text-primary" />
              <AlertDescription className="text-xs">
                No integration configured for {cfg.label} yet. Fill in the details and
                click <strong>Save</strong> to create one.
              </AlertDescription>
            </Alert>
          )}

          {/* Security note */}
          <div className="flex items-start gap-2 rounded-lg bg-accent/20 px-3 py-2.5 text-xs text-accent-foreground">
            <ShieldCheck className="size-4 mt-0.5 shrink-0" />
            <span>
              API keys are stored server-side only and are never exposed to the
              frontend. The masked preview shows only the first and last 4 characters.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap sm:flex-nowrap">
          {integration ? (
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="mr-auto"
              disabled={saving || testing || deleting}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving || testing || deleting}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleTest}
            disabled={!integration || saving || testing || deleting}
            title={integration ? "Test connection" : "Save the integration first to test"}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Test
          </Button>
          <Button onClick={handleSave} disabled={saving || testing || deleting}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </Button>
        </DialogFooter>

        {/* Send Test Email — only for email category (below the Save button) */}
        {category === "email" ? (
          <div className="space-y-3 pt-4 border-t mt-2">
            <div className="space-y-1">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Send className="size-3.5" />
                Send a Test Email
              </div>
              <p className="text-xs text-muted-foreground">
                Test email verifies your email provider configuration.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                placeholder="you@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="flex-1"
                disabled={sendingTestEmail}
              />
              <Button
                variant="secondary"
                onClick={handleSendTestEmail}
                disabled={sendingTestEmail || !testEmail.trim()}
                className="shrink-0"
              >
                {sendingTestEmail ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Send Test Email
              </Button>
            </div>
          </div>
        ) : null}

        {/* Delete confirmation */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this integration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the {cfg.label} integration
                {integration ? (
                  <>
                    {" "}(<strong>{providerLabel(category, integration.provider)}</strong>)
                  </>
                ) : null}
                {" "}and any stored API key. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
                disabled={deleting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

// ─── Built-in Dialog (website_widget) ─────────────────────────────────

function BuiltInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [publicKey, setPublicKey] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<false | "script" | "iframe">(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/business")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPublicKey(d.business?.publicKey || "");
      })
      .catch(() => {
        if (!cancelled) setPublicKey("");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !loaded;

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://ai.danetstecpro.com";
  const embedScript = `<script src="${origin}/widget.js?pk=${publicKey}" async></script>`;
  const iframeSnippet = `<iframe src="${origin}/widget-demo?pk=${publicKey}" width="380" height="560" frameborder="0"></iframe>`;

  async function copy(text: string, label: "script" | "iframe") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label === "script" ? "Embed script" : "Iframe snippet"} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="size-7 rounded-md flex items-center justify-center bg-primary/15">
              <Code2 className="size-4 text-primary" />
            </div>
            Website Widget
          </DialogTitle>
          <DialogDescription>
            The Danets chatbot widget is built-in and requires no configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Alert className="border-emerald-500/20 bg-emerald-500/5">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertTitle className="text-emerald-700 dark:text-emerald-400">
              Always active
            </AlertTitle>
            <AlertDescription className="text-xs">
              The widget runs on every plan and is ready to embed on your website — no
              API key or backend setup needed.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Code2 className="size-3.5" />
              Embed script
            </Label>
            <div className="relative rounded-lg bg-zinc-950 text-zinc-50 p-3 text-xs font-mono overflow-x-auto">
              <pre className="whitespace-pre-wrap break-all pr-8">
                {loading ? "Loading…" : embedScript}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-1.5 right-1.5 text-zinc-400 hover:text-white hover:bg-white/10 size-7"
                onClick={() => copy(embedScript, "script")}
                disabled={loading || !publicKey}
              >
                {copied === "script" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Code2 className="size-3.5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this snippet before the closing <code className="font-mono">&lt;/body&gt;</code> tag
              on every page where you want the chatbot to appear.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Iframe preview <span className="text-muted-foreground">(optional)</span></Label>
            <div className="relative rounded-lg bg-zinc-950 text-zinc-50 p-3 text-xs font-mono overflow-x-auto">
              <pre className="whitespace-pre-wrap break-all pr-8">
                {loading ? "Loading…" : iframeSnippet}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-1.5 right-1.5 text-zinc-400 hover:text-white hover:bg-white/10 size-7"
                onClick={() => copy(iframeSnippet, "iframe")}
                disabled={loading || !publicKey}
              >
                {copied === "iframe" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Code2 className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-accent/20 px-3 py-2.5 text-xs text-accent-foreground">
            <ShieldCheck className="size-4 mt-0.5 shrink-0" />
            <span>
              Your public key (<code className="font-mono">{publicKey || "…"}</code>) is safe to
              expose — it only identifies your business publicly.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main view ────────────────────────────────────────────────────────

export function IntegrationsView({ user }: { user: IntegrationsUser }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [builtInOpen, setBuiltInOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const res = await fetch("/api/integrations", { method: "GET" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load integrations");
      setIntegrations((data.integrations as Integration[]) ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load integrations";
      toast.error("Failed to load integrations", { description: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const integrationByCategory = (cat: Category) =>
    integrations.find((i) => i.category === cat);

  const activeCount = integrations.filter((i) => i.status === "active").length + 1; // +1 for built-in widget
  const configuredCount = integrations.length + 1;

  function handleSaved(updated: Integration) {
    setIntegrations((prev) => {
      const idx = prev.findIndex((i) => i.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
  }

  function handleDeleted(id: string) {
    setIntegrations((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <span className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Plug className="size-4.5 text-primary" />
            </span>
            Integrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect third-party providers and services.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing}
          className="shrink-0"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Security note */}
      <Alert className="border-primary/20 bg-primary/5">
        <ShieldCheck className="size-4 text-primary" />
        <AlertDescription className="text-sm">
          <strong className="text-foreground">Security:</strong> API keys are stored
          server-side only and never exposed to the frontend. Masked previews show only
          the first and last 4 characters.
        </AlertDescription>
      </Alert>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Configured</div>
          <div className="text-xl font-semibold mt-0.5">{configuredCount} / {CATEGORIES.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Active</div>
          <div className="text-xl font-semibold mt-0.5 text-emerald-600 dark:text-emerald-400">
            {activeCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Categories</div>
          <div className="text-xl font-semibold mt-0.5">{CATEGORIES.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Business</div>
          <div className="text-sm font-semibold mt-0.5 truncate" title={user.businessName}>
            {user.businessName}
          </div>
        </Card>
      </div>

      {/* Categories grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: CATEGORIES.length }).map((_, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-3 w-20 mt-4" />
              <Skeleton className="h-5 w-32 mt-3" />
              <Separator className="my-4" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <CategoryCard
              key={cat}
              category={cat}
              integration={integrationByCategory(cat)}
              onConfigure={() => {
                if (CATEGORY_CONFIG[cat].builtIn) {
                  setBuiltInOpen(true);
                } else {
                  setActiveCategory(cat);
                }
              }}
            />
          ))}
        </div>
      )}

      <ConnectedAccounts />

      {/* Empty / footer notice */}
      {!loading && integrations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Plug className="size-6 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No integrations configured yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click <strong>Configure</strong> on any category card above to set up your
            first integration.
          </p>
        </div>
      ) : null}

      {/* Config dialog */}
      {activeCategory ? (
        <ConfigDialog
          category={activeCategory}
          integration={integrationByCategory(activeCategory)}
          open={!!activeCategory}
          onOpenChange={(v) => {
            if (!v) setActiveCategory(null);
          }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          userEmail={user.email}
        />
      ) : null}

      {/* Built-in dialog (website_widget) */}
      <BuiltInDialog
        open={builtInOpen}
        onOpenChange={setBuiltInOpen}
      />
    </div>
  );
}
