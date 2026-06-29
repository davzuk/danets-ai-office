"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Loader2,
  Save,
  Send,
  Sparkles,
  ShieldAlert,
  Palette,
  MessageSquareText,
  Phone,
  Mail,
  Building2,
  RefreshCw,
  CircleCheck,
  CircleDashed,
  Hash,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface AgentUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface AiAgent {
  id: string;
  botName: string;
  businessName: string | null;
  industry: string | null;
  welcomeMessage: string;
  fallbackMessage: string;
  handoverMessage: string;
  tone: "professional" | "friendly" | "formal";
  contactPhone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  brandColor: string;
  status: "active" | "inactive";
  leadCaptureEnabled: boolean;
}

type AgentForm = {
  botName: string;
  businessName: string;
  industry: string;
  welcomeMessage: string;
  fallbackMessage: string;
  handoverMessage: string;
  tone: "professional" | "friendly" | "formal";
  contactPhone: string;
  whatsappNumber: string;
  email: string;
  brandColor: string;
  status: "active" | "inactive";
  leadCaptureEnabled: boolean;
};

const DEFAULT_AGENT: AgentForm = {
  botName: "Assistant",
  businessName: "",
  industry: "",
  welcomeMessage: "Hi! How can I help you today?",
  fallbackMessage:
    "I'm not fully sure about that. Please contact our team for confirmation.",
  handoverMessage:
    "Let me connect you with our team for further assistance.",
  tone: "professional",
  contactPhone: "",
  whatsappNumber: "",
  email: "",
  brandColor: "#1d4ed8",
  status: "active",
  leadCaptureEnabled: true,
};

const TONE_OPTIONS: {
  value: AgentForm["tone"];
  label: string;
  description: string;
}[] = [
  {
    value: "professional",
    label: "Professional",
    description: "Clear, knowledgeable, business-like tone.",
  },
  {
    value: "friendly",
    label: "Friendly",
    description: "Warm and conversational, approachable.",
  },
  {
    value: "formal",
    label: "Formal",
    description: "Polite, structured, complete sentences.",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Compute readable text color (black/white) for a given hex background
function readableTextOn(hex: string): string {
  if (!HEX_RE.test(hex)) return "#ffffff";
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0b1220" : "#ffffff";
}

export function AgentView({ user }: { user: AgentUser }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AgentForm>(DEFAULT_AGENT);
  const [original, setOriginal] = useState<AgentForm>(DEFAULT_AGENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const testScrollRef = useRef<HTMLDivElement | null>(null);

  // Test panel state
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [testHistory, setTestHistory] = useState<
    { role: "user" | "assistant"; content: string; kbCount?: number }[]
  >([]);

  const loadAgent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent", { method: "GET" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load agent");
      const a = data.agent as AiAgent;
      const normalized: AgentForm = {
        ...DEFAULT_AGENT,
        ...a,
        businessName: a.businessName ?? "",
        industry: a.industry ?? "",
        contactPhone: a.contactPhone ?? "",
        whatsappNumber: a.whatsappNumber ?? "",
        email: a.email ?? "",
      };
      setForm(normalized);
      setOriginal(normalized);
    } catch (e: any) {
      toast.error(e.message || "Could not load agent configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  // Dirty-state detection (deep equality on normalized strings)
  const isDirty = useMemo(() => {
    const keys: (keyof AgentForm)[] = [
      "botName",
      "businessName",
      "industry",
      "welcomeMessage",
      "fallbackMessage",
      "handoverMessage",
      "tone",
      "contactPhone",
      "whatsappNumber",
      "email",
      "brandColor",
      "status",
      "leadCaptureEnabled",
    ];
    return keys.some((k) => form[k] !== original[k]);
  }, [form, original]);

  function setField<K extends keyof AgentForm>(key: K, value: AgentForm[K]) {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) {
      setErrors((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.botName.trim()) e.botName = "Bot name is required.";
    if (!form.welcomeMessage.trim()) e.welcomeMessage = "Welcome message is required.";
    if (!form.fallbackMessage.trim()) e.fallbackMessage = "Fallback message is required.";
    if (!form.handoverMessage.trim()) e.handoverMessage = "Handover message is required.";
    if (form.email && !EMAIL_RE.test(form.email)) e.email = "Invalid email format.";
    if (!HEX_RE.test(form.brandColor)) e.brandColor = "Use a hex color like #1d4ed8.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        botName: form.botName.trim(),
        businessName: form.businessName.trim() || null,
        industry: form.industry.trim() || null,
        welcomeMessage: form.welcomeMessage.trim(),
        fallbackMessage: form.fallbackMessage.trim(),
        handoverMessage: form.handoverMessage.trim(),
        tone: form.tone,
        contactPhone: form.contactPhone.trim() || null,
        whatsappNumber: form.whatsappNumber.trim() || null,
        email: form.email.trim() || null,
        brandColor: form.brandColor,
        status: form.status,
        leadCaptureEnabled: form.leadCaptureEnabled,
      };
      const res = await fetch("/api/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save agent.");
      const a = data.agent as AiAgent;
      const normalized: AgentForm = {
        ...DEFAULT_AGENT,
        ...a,
        businessName: a.businessName ?? "",
        industry: a.industry ?? "",
        contactPhone: a.contactPhone ?? "",
        whatsappNumber: a.whatsappNumber ?? "",
        email: a.email ?? "",
      };
      setForm(normalized);
      setOriginal(normalized);
      toast.success("AI Agent configuration saved.");
    } catch (e: any) {
      toast.error(e.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const msg = testMessage.trim();
    if (!msg || testing) return;
    setTesting(true);
    setTestHistory((h) => [...h, { role: "user", content: msg }]);
    setTestMessage("");
    try {
      const res = await fetch("/api/agent/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed.");
      setTestHistory((h) => [
        ...h,
        {
          role: "assistant",
          content: data.reply,
          kbCount: data.kbContextCount,
        },
      ]);
    } catch (e: any) {
      setTestHistory((h) => [
        ...h,
        {
          role: "assistant",
          content: `⚠️ ${e.message || "Test failed."}`,
        },
      ]);
    } finally {
      setTesting(false);
      setTimeout(() => {
        testScrollRef.current?.scrollTo({
          top: testScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 50);
    }
  }

  const brandTextColor = readableTextOn(form.brandColor);
  const avatarInitial = (form.botName || "A").charAt(0).toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              AI Agent Configuration
            </h1>
            {isDirty ? (
              <Badge
                variant="outline"
                className="border-accent text-accent-foreground bg-accent/20"
              >
                <CircleDashed className="h-3 w-3" />
                Unsaved changes
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <CircleCheck className="h-3 w-3 text-accent-foreground" />
                In sync
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Configure how your AI chatbot looks, sounds, and responds to
            visitors. Test it live before going public.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAgent}
            disabled={saving}
          >
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
          <Button
            onClick={save}
            disabled={!isDirty || saving}
            size="sm"
            className="bg-primary hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-5">
        {/* ── LEFT: config form ─────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Bot identity preview */}
          <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: form.brandColor }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-foreground" />
                Bot identity preview
              </CardTitle>
              <CardDescription>
                This is how visitors will see your bot in the chat widget.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                  style={{
                    backgroundColor: form.brandColor,
                    color: brandTextColor,
                  }}
                >
                  {avatarInitial}
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {form.botName || "Assistant"}
                    </span>
                    {form.status === "active" ? (
                      <Badge className="bg-accent text-accent-foreground hover:bg-accent">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent-foreground/70 animate-pulse" />
                        Online
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Offline</Badge>
                    )}
                  </div>
                  <div
                    className="inline-block rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-full"
                    style={{
                      backgroundColor: form.brandColor,
                      color: brandTextColor,
                    }}
                  >
                    {form.welcomeMessage || "Hi! How can I help you today?"}
                  </div>
                  {form.businessName && (
                    <div className="text-xs text-muted-foreground">
                      from {form.businessName}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs: identity / messaging / contact */}
          <Tabs defaultValue="identity">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="identity">
                <Bot className="h-4 w-4" />
                Identity
              </TabsTrigger>
              <TabsTrigger value="messaging">
                <MessageSquareText className="h-4 w-4" />
                Messaging
              </TabsTrigger>
              <TabsTrigger value="contact">
                <Phone className="h-4 w-4" />
                Contact &amp; Status
              </TabsTrigger>
            </TabsList>

            {/* Identity tab */}
            <TabsContent value="identity" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bot identity</CardTitle>
                  <CardDescription>
                    Basic branding and personality.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field
                      label="Bot name"
                      icon={<Bot className="h-4 w-4" />}
                      required
                      error={errors.botName}
                    >
                      <Input
                        value={form.botName}
                        onChange={(e) => setField("botName", e.target.value)}
                        placeholder="Assistant"
                        maxLength={60}
                      />
                    </Field>
                    <Field
                      label="Business name"
                      icon={<Building2 className="h-4 w-4" />}
                    >
                      <Input
                        value={form.businessName}
                        onChange={(e) =>
                          setField("businessName", e.target.value)
                        }
                        placeholder={user.businessName}
                        maxLength={120}
                      />
                    </Field>
                    <Field
                      label="Industry"
                      icon={<Building2 className="h-4 w-4" />}
                    >
                      <Input
                        value={form.industry}
                        onChange={(e) => setField("industry", e.target.value)}
                        placeholder="e.g. Retail, SaaS, Healthcare"
                        maxLength={80}
                      />
                    </Field>
                    <Field
                      label="Tone of voice"
                      icon={<MessageSquareText className="h-4 w-4" />}
                    >
                      <Select
                        value={form.tone}
                        onValueChange={(v) =>
                          setField("tone", v as AgentForm["tone"])
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TONE_OPTIONS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              <div className="flex flex-col">
                                <span className="font-medium">{t.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {t.description}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <Separator />

                  <Field
                    label="Brand color"
                    icon={<Palette className="h-4 w-4" />}
                    error={errors.brandColor}
                    hint="Used for the chat bubble, avatar and widget accents."
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-10 w-10 rounded-md border shadow-sm shrink-0"
                        style={{ backgroundColor: form.brandColor }}
                      />
                      <Input
                        type="color"
                        value={form.brandColor}
                        onChange={(e) =>
                          setField("brandColor", e.target.value)
                        }
                        className="h-10 w-14 p-1 cursor-pointer"
                      />
                      <Input
                        value={form.brandColor}
                        onChange={(e) =>
                          setField("brandColor", e.target.value)
                        }
                        placeholder="#1d4ed8"
                        className="max-w-[160px]"
                      />
                    </div>
                  </Field>

                  {/* Live preview chat bubble */}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      Live chat bubble preview
                    </div>
                    <div className="flex items-start gap-2">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{
                          backgroundColor: form.brandColor,
                          color: brandTextColor,
                        }}
                      >
                        {avatarInitial}
                      </div>
                      <div
                        className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]"
                        style={{
                          backgroundColor: form.brandColor,
                          color: brandTextColor,
                        }}
                      >
                        {form.welcomeMessage || "Hi! How can I help you today?"}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Messaging tab */}
            <TabsContent value="messaging" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Messaging</CardTitle>
                  <CardDescription>
                    Key messages your bot uses during conversations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field
                    label="Welcome message"
                    icon={<MessageSquareText className="h-4 w-4" />}
                    required
                    error={errors.welcomeMessage}
                    hint="Shown when a visitor opens the chat."
                  >
                    <Textarea
                      value={form.welcomeMessage}
                      onChange={(e) =>
                        setField("welcomeMessage", e.target.value)
                      }
                      rows={2}
                      maxLength={500}
                    />
                  </Field>
                  <Field
                    label="Fallback message"
                    icon={<ShieldAlert className="h-4 w-4" />}
                    required
                    error={errors.fallbackMessage}
                    hint="Used when the bot can't answer confidently."
                  >
                    <Textarea
                      value={form.fallbackMessage}
                      onChange={(e) =>
                        setField("fallbackMessage", e.target.value)
                      }
                      rows={3}
                      maxLength={500}
                    />
                  </Field>
                  <Field
                    label="Handover message"
                    icon={<MessageSquareText className="h-4 w-4" />}
                    required
                    error={errors.handoverMessage}
                    hint="Shown when escalating to a human teammate."
                  >
                    <Textarea
                      value={form.handoverMessage}
                      onChange={(e) =>
                        setField("handoverMessage", e.target.value)
                      }
                      rows={2}
                      maxLength={500}
                    />
                  </Field>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Contact & Status tab */}
            <TabsContent value="contact" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Contact details &amp; status
                  </CardTitle>
                  <CardDescription>
                    The bot can share these when escalating. All optional.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field
                      label="Contact phone"
                      icon={<Phone className="h-4 w-4" />}
                    >
                      <Input
                        value={form.contactPhone}
                        onChange={(e) =>
                          setField("contactPhone", e.target.value)
                        }
                        placeholder="+1 555 000 0000"
                        maxLength={40}
                      />
                    </Field>
                    <Field
                      label="WhatsApp number"
                      icon={<Phone className="h-4 w-4" />}
                    >
                      <Input
                        value={form.whatsappNumber}
                        onChange={(e) =>
                          setField("whatsappNumber", e.target.value)
                        }
                        placeholder="+1 555 000 0000"
                        maxLength={40}
                      />
                    </Field>
                    <Field
                      label="Email"
                      icon={<Mail className="h-4 w-4" />}
                      error={errors.email}
                    >
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => setField("email", e.target.value)}
                        placeholder="support@yourbusiness.com"
                        maxLength={120}
                      />
                    </Field>
                  </div>

                  <Separator />

                  {/* Status switch */}
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">
                        {form.status === "active"
                          ? "Agent active"
                          : "Agent inactive"}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        When active, the chat widget accepts new conversations.
                        Inactive bots stay hidden from visitors.
                      </p>
                    </div>
                    <Switch
                      checked={form.status === "active"}
                      onCheckedChange={(v) =>
                        setField("status", v ? "active" : "inactive")
                      }
                    />
                  </div>

                  {/* Lead capture switch */}
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <Hash className="h-4 w-4 text-accent-foreground" />
                        Lead capture
                        {form.leadCaptureEnabled && (
                          <Badge className="bg-accent text-accent-foreground hover:bg-accent">
                            On
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Collect visitor name, email and phone into your Leads
                        inbox.
                      </p>
                    </div>
                    <Switch
                      checked={form.leadCaptureEnabled}
                      onCheckedChange={(v) =>
                        setField("leadCaptureEnabled", v)
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Sticky save bar (mobile-friendly fallback) */}
          <div className="sticky bottom-0 z-10 -mx-1 px-1">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur p-3 shadow-sm">
              <div className="text-xs text-muted-foreground">
                {isDirty
                  ? "You have unsaved changes."
                  : "All changes saved."}
              </div>
              <Button
                onClick={save}
                disabled={!isDirty || saving}
                size="sm"
                className="bg-primary hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save changes
              </Button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: test panel ─────────────────────────────────────── */}
        <div className="xl:sticky xl:top-20 self-start">
          <Card className="flex flex-col h-[640px]">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Send className="h-4 w-4 text-accent-foreground" />
                    Test your bot
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Send a message to preview live AI replies.
                  </CardDescription>
                </div>
                {form.status === "active" ? (
                  <Badge className="bg-accent text-accent-foreground hover:bg-accent">
                    Online
                  </Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-0 min-h-0">
              {/* Test conversation area */}
              <div
                ref={testScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 scroll-thin min-h-0"
              >
                {testHistory.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <div
                      className="h-14 w-14 rounded-full flex items-center justify-center font-bold text-xl mb-3"
                      style={{
                        backgroundColor: form.brandColor,
                        color: brandTextColor,
                      }}
                    >
                      {avatarInitial}
                    </div>
                    <p className="text-sm font-medium">
                      {form.botName || "Assistant"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Try a question your customers might ask — pricing,
                      services, hours, etc.
                    </p>
                  </div>
                )}

                {testHistory.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className="flex items-end gap-2 max-w-[85%]">
                      {m.role === "assistant" && (
                        <div
                          className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{
                            backgroundColor: form.brandColor,
                            color: brandTextColor,
                          }}
                        >
                          {avatarInitial}
                        </div>
                      )}
                      <div>
                        <div
                          className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            m.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          }`}
                        >
                          {m.content}
                        </div>
                        {m.role === "assistant" &&
                          typeof m.kbCount === "number" && (
                            <div className="text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              {m.kbCount > 0
                                ? `${m.kbCount} KB article${
                                    m.kbCount === 1 ? "" : "s"
                                  } used`
                                : "No KB context"}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ))}

                {testing && (
                  <div className="flex justify-start">
                    <div className="flex items-end gap-2">
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          backgroundColor: form.brandColor,
                          color: brandTextColor,
                        }}
                      >
                        {avatarInitial}
                      </div>
                      <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Test input */}
              <div className="border-t p-3 space-y-2">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendTest();
                      }
                    }}
                    placeholder="Type a test message…"
                    rows={2}
                    className="resize-none text-sm min-h-[44px] max-h-32"
                    disabled={testing}
                  />
                  <Button
                    onClick={sendTest}
                    disabled={testing || !testMessage.trim()}
                    size="icon"
                    className="h-10 w-10 bg-primary hover:bg-primary/90 shrink-0"
                    title="Send test message"
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  Rate-limited · 20 tests / minute · Enter to send, Shift+Enter
                  for newline
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium flex items-center gap-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
