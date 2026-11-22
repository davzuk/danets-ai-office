"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SubscriptionUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

// ── API response shapes ─────────────────────────────────────────────────
interface PlanInfo {
  name: string;
  priceUsd: number;
  chatLimit: number;
  leadLimit: number;
  kbLimit: number;
  ticketLimit: number;
  documentLimit: number;
  automationLimit: number;
  seatLimit: number;
  whatsappTemplateLimit: number;
  integrationLimit: number;
  proposalTemplateLimit: number;
  quoteLimit: number;
  bookingTypeLimit?: number;
  features: string[];
}

interface SubscriptionRecord {
  id: string;
  planName: string;
  status: string;
  startDate: string;
  endDate: string | null;
  trialEndsAt: string | null;
  monthlyFee: number;
  paymentMethod: string | null;
  downgradeScheduledFor: string | null;
  downgradeTargetPlan: string | null;
}

interface UsageStats {
  chats: number;
  leads: number;
  kbItems: number;
  aiRequests: number;
  tickets: number;
  documents: number;
  automations: number;
  seats: number;
  whatsappTemplates: number;
  integrations: number;
  proposalTemplates: number;
  quotes: number;
  bookingTypes?: number;
}

interface SubscriptionData {
  subscription: SubscriptionRecord;
  plan: PlanInfo | null;
  usage: UsageStats;
  allPlans: PlanInfo[];
}

// ── Payment / Invoice shapes (P2-SUB) ───────────────────────────────────
interface InvoiceItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

interface InvoicePaymentSummary {
  id: string;
  reference: string;
  provider: string;
  status: string;
}

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  items: InvoiceItem[];
  notes: string | null;
  payment: InvoicePaymentSummary | null;
  createdAt: string;
}

interface InvoicesResponse {
  invoices: InvoiceRecord[];
}

interface InitPaymentRecord {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  planName: string;
  billingCycle: string;
}

interface InitializeResponse {
  payment: InitPaymentRecord | null;
  paymentUrl?: string;
  note?: string;
  redirected?: boolean;
  message?: string;
}

interface VerifyResponse {
  payment: unknown;
  subscription: unknown;
  invoice?: { id: string; invoiceNumber: string; amount: number };
  message: string;
}

// ── Static meta ──────────────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  business: "Business",
  premium: "Premium",
  enterprise: "Enterprise",
};

interface StatusMeta {
  label: string;
  className: string;
  dotClassName: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  active: {
    label: "Active",
    className:
      "bg-accent/30 text-[#4d7c0f] border-transparent hover:bg-accent/40",
    dotClassName: "bg-[#4d7c0f]",
  },
  trial: {
    label: "Trial",
    className:
      "bg-amber-100 text-amber-800 border-transparent hover:bg-amber-100/80 dark:bg-amber-900/30 dark:text-amber-300",
    dotClassName: "bg-amber-500",
  },
  past_due: {
    label: "Past Due",
    className: "bg-destructive/15 text-destructive border-transparent",
    dotClassName: "bg-destructive",
  },
  canceled: {
    label: "Canceled",
    className:
      "bg-muted text-muted-foreground border-transparent hover:bg-muted/80",
    dotClassName: "bg-muted-foreground",
  },
  expired: {
    label: "Expired",
    className:
      "bg-muted text-muted-foreground border-transparent hover:bg-muted/80",
    dotClassName: "bg-muted-foreground",
  },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  bank_transfer: "Bank Transfer",
  manual: "Manual",
};

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "paystack", label: "Paystack" },
  { value: "flutterwave", label: "Flutterwave" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "manual", label: "Manual" },
];

interface InvoiceStatusMeta {
  label: string;
  className: string;
}

const INVOICE_STATUS_META: Record<string, InvoiceStatusMeta> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-transparent",
  },
  sent: {
    label: "Sent",
    className:
      "bg-amber-100 text-amber-800 border-transparent dark:bg-amber-900/30 dark:text-amber-300",
  },
  paid: {
    label: "Paid",
    className:
      "bg-emerald-100 text-emerald-800 border-transparent dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  void: {
    label: "Void",
    className: "bg-destructive/15 text-destructive border-transparent",
  },
  overdue: {
    label: "Overdue",
    className:
      "bg-red-100 text-red-800 border-transparent dark:bg-red-900/30 dark:text-red-300",
  },
};

function invoiceStatusMeta(status: string): InvoiceStatusMeta {
  return (
    INVOICE_STATUS_META[status] ?? {
      label: status.charAt(0).toUpperCase() + status.slice(1),
      className: "bg-muted text-muted-foreground border-transparent",
    }
  );
}

// Bank details for manual / bank_transfer payments (P2-SUB)
const BANK_DETAILS = {
  bank: "Zenith Bank",
  accountName: "Danets TecPro Limited",
  accountNumber: "1012345678",
} as const;

const ANNUAL_DISCOUNT = 0.2; // 20% off when paying annually

// ── Helpers ──────────────────────────────────────────────────────────────

function planLabel(name: string): string {
  return PLAN_LABEL[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function PlanIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  switch (name) {
    case "free":
      return <Zap className={className} />;
    case "starter":
      return <TrendingUp className={className} />;
    case "business":
      return <CreditCard className={className} />;
    case "premium":
    case "enterprise":
      return <Crown className={className} />;
    default:
      return <CreditCard className={className} />;
  }
}

function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status.charAt(0).toUpperCase() + status.slice(1),
      className: "bg-muted text-muted-foreground border-transparent",
      dotClassName: "bg-muted-foreground",
    }
  );
}

function paymentLabel(method: string | null): string | null {
  if (!method) return null;
  return PAYMENT_METHOD_LABEL[method] ?? method;
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function formatMoneyWithCurrency(n: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function annualPrice(monthly: number): number {
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100;
}

function annualSavings(monthly: number): number {
  return Math.round((monthly * 12 - annualPrice(monthly)) * 100) / 100;
}

function usageBarClass(pct: number): string {
  if (pct > 90) return "[&_[data-slot=progress-indicator]]:bg-destructive";
  if (pct >= 60) return "[&_[data-slot=progress-indicator]]:bg-amber-500";
  return "[&_[data-slot=progress-indicator]]:bg-primary";
}

function usageTone(pct: number): "green" | "amber" | "red" {
  if (pct > 90) return "red";
  if (pct >= 60) return "amber";
  return "green";
}

const TONE_TEXT: Record<"green" | "amber" | "red", string> = {
  green: "text-primary",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-destructive",
};

// ── Main view ────────────────────────────────────────────────────────────

export function SubscriptionView({
  user: _user,
}: {
  user: SubscriptionUser;
}) {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState<PlanInfo | null>(null);

  // Invoice history state (P2-SUB)
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(
    null,
  );
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);

  const planComparisonRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscription", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Unauthorized. Please sign in again.");
        } else {
          setError(`Failed to load subscription (${res.status})`);
        }
        return;
      }
      const json = (await res.json()) as SubscriptionData;
      setData(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const res = await fetch("/api/invoices", { cache: "no-store" });
      if (!res.ok) {
        setInvoicesError(`Failed to load invoices (${res.status})`);
        return;
      }
      const json = (await res.json()) as InvoicesResponse;
      setInvoices(json.invoices ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setInvoicesError(msg);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadInvoices();
  }, [load, loadInvoices]);

  const currentPlan = useMemo<PlanInfo | null>(() => {
    if (!data) return null;
    if (data.plan) return data.plan;
    // Fallback: find the plan matching the subscription's planName
    return (
      data.allPlans.find((p) => p.name === data.subscription.planName) ?? null
    );
  }, [data]);

  // Trial detection — status === "trial" OR trialEndsAt is in the future
  const trialInfo = useMemo(() => {
    if (!data) return null;
    const { status, trialEndsAt } = data.subscription;
    const isTrialStatus = status === "trial";
    const days = daysUntil(trialEndsAt);
    const trialActive =
      isTrialStatus || (trialEndsAt !== null && days !== null && days > 0);
    if (!trialActive) return null;
    return { daysRemaining: days ?? 0, trialEndsAt };
  }, [data]);

  function openChangeDialog(plan: PlanInfo) {
    setTargetPlan(plan);
    setDialogOpen(true);
  }

  function handleChangeSuccess() {
    setDialogOpen(false);
    setTargetPlan(null);
    load();
    loadInvoices();
  }

  function scrollToPlans() {
    planComparisonRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function openInvoice(invoice: InvoiceRecord) {
    setSelectedInvoice(invoice);
    setInvoiceDialogOpen(true);
  }

  const refreshing = loading || invoicesLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Subscription &amp; Billing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your plan and track usage.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            load();
            loadInvoices();
          }}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load subscription</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading skeletons */}
      {loading && !data && (
        <div className="space-y-6">
          <CurrentPlanSkeleton />
          <UsageSkeleton />
          <PlansGridSkeleton />
        </div>
      )}

      {data && !error && (
        <>
          {/* Trial banner (P2-SUB) */}
          {trialInfo && (
            <TrialBanner
              daysRemaining={trialInfo.daysRemaining}
              trialEndsAt={trialInfo.trialEndsAt}
              onUpgrade={scrollToPlans}
            />
          )}

          {/* Current plan card */}
          <CurrentPlanCard
            subscription={data.subscription}
            plan={currentPlan}
            onReactivate={scrollToPlans}
          />

          {/* Usage this month */}
          <UsageThisMonth usage={data.usage} plan={currentPlan} />

          {/* Plan comparison */}
          <div ref={planComparisonRef} className="scroll-mt-6">
            <PlanComparisonGrid
              plans={data.allPlans}
              currentPlanName={data.subscription.planName}
              currentPriceUsd={currentPlan?.priceUsd ?? 0}
              onSelect={openChangeDialog}
            />
          </div>

          {/* Invoice history (P2-SUB) */}
          <InvoiceHistory
            invoices={invoices}
            loading={invoicesLoading}
            error={invoicesError}
            onRetry={loadInvoices}
            onSelect={openInvoice}
          />

          {/* Security note */}
          <SecurityNote />
        </>
      )}

      {/* Change plan dialog */}
      <ChangePlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targetPlan={targetPlan}
        currentPlan={currentPlan}
        onConfirm={handleChangeSuccess}
      />

      {/* Invoice detail dialog (P2-SUB) */}
      <InvoiceDetailDialog
        invoice={selectedInvoice}
        open={invoiceDialogOpen}
        onOpenChange={(o) => {
          setInvoiceDialogOpen(o);
          if (!o) setSelectedInvoice(null);
        }}
      />
    </div>
  );
}

// ── Current plan card ────────────────────────────────────────────────────

function CurrentPlanCard({
  subscription,
  plan,
  onReactivate,
}: {
  subscription: SubscriptionRecord;
  plan: PlanInfo | null;
  onReactivate: () => void;
}) {
  const meta = statusMeta(subscription.status);
  const startDate = formatDate(subscription.startDate);
  const endDate = formatDate(subscription.endDate);
  const trialEnd = formatDate(subscription.trialEndsAt);
  const payLabel = paymentLabel(subscription.paymentMethod);

  return (
    <Card className="overflow-hidden border-primary/20">
      {/* Payment status banner (P2-SUB) */}
      <PaymentStatusBanner
        status={subscription.status}
        onReactivate={onReactivate}
      />
      <div className="bg-gradient-to-br from-primary/10 via-accent/10 to-transparent">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 bg-primary/15 text-primary">
              <PlanIcon name={subscription.planName} className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <CardDescription className="uppercase tracking-wide text-xs">
                Current Plan
              </CardDescription>
              <CardTitle className="text-3xl font-bold tracking-tight mt-1">
                {planLabel(subscription.planName)}
              </CardTitle>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-semibold">
                  ${formatMoney(plan?.priceUsd ?? subscription.monthlyFee)}
                </span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              {subscription.downgradeScheduledFor && subscription.downgradeTargetPlan && (
                <Badge
                  variant="outline"
                  className="mt-2 gap-1.5 text-amber-600 border-amber-500/40 bg-amber-500/10"
                  title={`Your plan will switch to ${planLabel(
                    subscription.downgradeTargetPlan
                  )} at the end of the current billing period.`}
                >
                  <Clock className="h-3 w-3" />
                  Scheduled to switch to {planLabel(subscription.downgradeTargetPlan)} on{" "}
                  {formatDate(subscription.downgradeScheduledFor)}
                </Badge>
              )}
            </div>
          </div>
          <Badge className={`gap-1.5 ${meta.className}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName} ${
                subscription.status === "active" ? "animate-pulse" : ""
              }`}
            />
            {meta.label}
          </Badge>
        </CardHeader>
      </div>
      <CardContent className="pt-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetaItem
            icon={<CalendarDays className="h-4 w-4" />}
            label="Started"
            value={startDate ?? "—"}
          />
          <MetaItem
            icon={<CalendarDays className="h-4 w-4" />}
            label="Renews / Ends"
            value={endDate ?? "Auto-renew"}
          />
          {subscription.status === "trial" && trialEnd && (
            <MetaItem
              icon={<Sparkles className="h-4 w-4" />}
              label="Trial Ends"
              value={trialEnd}
              tone="amber"
            />
          )}
          <MetaItem
            icon={<CreditCard className="h-4 w-4" />}
            label="Payment Method"
            value={payLabel ?? "Not set"}
            muted={payLabel ? false : true}
          />
          <MetaItem
            icon={<TrendingUp className="h-4 w-4" />}
            label="Monthly Fee"
            value={`$${formatMoney(subscription.monthlyFee)}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetaItem({
  icon,
  label,
  value,
  muted,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
  tone?: "amber";
}) {
  const valueClass =
    tone === "amber"
      ? "text-amber-600 dark:text-amber-400 font-medium"
      : muted
      ? "text-muted-foreground italic"
      : "text-foreground font-medium";
  return (
    <div className="flex items-start gap-2.5">
      <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className={`text-sm truncate ${valueClass}`}>{value}</div>
      </div>
    </div>
  );
}

// ── Usage this month ─────────────────────────────────────────────────────

interface UsageBarSpec {
  key: string;
  label: string;
  used: number;
  limit: number;
  description: string;
}

function UsageThisMonth({
  usage,
  plan,
}: {
  usage: UsageStats;
  plan: PlanInfo | null;
}) {
  const chatLimit = plan?.chatLimit ?? 0;
  const leadLimit = plan?.leadLimit ?? 0;
  const kbLimit = plan?.kbLimit ?? 0;
  // AI requests share the chat limit as a proxy per spec.
  const aiLimit = chatLimit;
  const ticketLimit = plan?.ticketLimit ?? 0;
  const documentLimit = plan?.documentLimit ?? 0;
  const automationLimit = plan?.automationLimit ?? 0;
  const seatLimit = plan?.seatLimit ?? 0;
  const whatsappTemplateLimit = plan?.whatsappTemplateLimit ?? 0;
  const integrationLimit = plan?.integrationLimit ?? 0;
  const proposalTemplateLimit = plan?.proposalTemplateLimit ?? 0;
  const quoteLimit = plan?.quoteLimit ?? 0;
  const bookingTypeLimit = plan?.bookingTypeLimit ?? 0;

  const bars: UsageBarSpec[] = [
    {
      key: "chats",
      label: "Chat sessions",
      used: usage.chats,
      limit: chatLimit,
      description: "Conversations started this month",
    },
    {
      key: "leads",
      label: "Leads captured",
      used: usage.leads,
      limit: leadLimit,
      description: "New leads from all channels",
    },
    {
      key: "kb",
      label: "Knowledge base items",
      used: usage.kbItems,
      limit: kbLimit,
      description: "Stored KB documents (lifetime)",
    },
    {
      key: "ai",
      label: "AI requests",
      used: usage.aiRequests,
      limit: aiLimit,
      description: "AI completions this month (proxy: chat limit)",
    },
    {
      key: "tickets",
      label: "Support tickets",
      used: usage.tickets,
      limit: ticketLimit,
      description: "Tickets opened this month",
    },
    {
      key: "documents",
      label: "Documents",
      used: usage.documents,
      limit: documentLimit,
      description: "Uploaded or pasted documents (lifetime)",
    },
    {
      key: "automations",
      label: "Automation workflows",
      used: usage.automations,
      limit: automationLimit,
      description: "Active and draft workflows",
    },
    {
      key: "seats",
      label: "Team members",
      used: usage.seats,
      limit: seatLimit,
      description: "Admins and members on your account",
    },
    {
      key: "whatsappTemplates",
      label: "WhatsApp templates",
      used: usage.whatsappTemplates,
      limit: whatsappTemplateLimit,
      description: "Reusable message templates",
    },
    {
      key: "integrations",
      label: "Integrations",
      used: usage.integrations,
      limit: integrationLimit,
      description: "External service connections",
    },
    {
      key: "proposalTemplates",
      label: "Proposal templates",
      used: usage.proposalTemplates,
      limit: proposalTemplateLimit,
      description: "Your business-specific templates",
    },
    {
      key: "quotes",
      label: "Quotes",
      used: usage.quotes,
      limit: quoteLimit,
      description: "AI-generated quotes this month",
    },
    {
      key: "bookingTypes",
      label: "Booking types",
      used: usage.bookingTypes ?? 0,
      limit: bookingTypeLimit,
      description: "Meeting types visitors can book",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Usage This Month
          </CardTitle>
          <CardDescription>
            Current billing period consumption against your plan limits.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {bars.map((b) => (
          <UsageBar key={b.key} spec={b} />
        ))}
        <Separator />
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5" />
          Usage resets on the 1st of each month.
        </p>
      </CardContent>
    </Card>
  );
}

function UsageBar({ spec }: { spec: UsageBarSpec }) {
  const { used, limit, label, description } = spec;
  const pct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
  const tone = usageTone(pct);
  const barClass = usageBarClass(pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{label}</div>
          <div className="text-xs text-muted-foreground truncate">
            {description}
          </div>
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0 tabular-nums">
          <span className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>
            {formatNumber(used)}
          </span>
          <span className="text-xs text-muted-foreground">
            / {limit > 0 ? formatNumber(limit) : "∞"}
          </span>
          <Badge
            variant="secondary"
            className={`text-[10px] h-5 ${
              tone === "red"
                ? "bg-destructive/15 text-destructive"
                : tone === "amber"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-accent/30 text-[#4d7c0f]"
            }`}
          >
            {pct}%
          </Badge>
        </div>
      </div>
      <Progress value={pct} className={`h-2 ${barClass}`} />
    </div>
  );
}

// ── Plan comparison grid ─────────────────────────────────────────────────

function PlanComparisonGrid({
  plans,
  currentPlanName,
  currentPriceUsd,
  onSelect,
}: {
  plans: PlanInfo[];
  currentPlanName: string;
  currentPriceUsd: number;
  onSelect: (plan: PlanInfo) => void;
}) {
  if (plans.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No plans are currently available. Please try again later.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Available Plans
        </CardTitle>
        <CardDescription>
          Compare features and limits across plans. Upgrade or downgrade anytime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              isCurrent={plan.name === currentPlanName}
              actionLabel={
                plan.name === currentPlanName
                  ? "current"
                  : plan.priceUsd > currentPriceUsd
                  ? "upgrade"
                  : plan.priceUsd < currentPriceUsd
                  ? "downgrade"
                  : "switch"
              }
              onSelect={onSelect}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanCard({
  plan,
  isCurrent,
  actionLabel,
  onSelect,
}: {
  plan: PlanInfo;
  isCurrent: boolean;
  actionLabel: "current" | "upgrade" | "downgrade" | "switch";
  onSelect: (plan: PlanInfo) => void;
}) {
  const features = Array.isArray(plan.features) ? plan.features : [];

  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-card p-5 transition-all ${
        isCurrent
          ? "border-primary ring-1 ring-primary/30 shadow-sm"
          : "hover:border-primary/40 hover:shadow-sm"
      }`}
    >
      {isCurrent && (
        <Badge className="absolute -top-2 left-5 bg-primary text-primary-foreground">
          Current Plan
        </Badge>
      )}

      <div className="flex items-center gap-2.5">
        <div
          className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
            isCurrent
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <PlanIcon name={plan.name} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold leading-tight truncate">
            {planLabel(plan.name)}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tracking-tight">
              ${formatMoney(plan.priceUsd)}
            </span>
            <span className="text-xs text-muted-foreground">/mo</span>
          </div>
        </div>
      </div>

      <Separator className="my-4" />

      {/* Limits */}
      <div className="space-y-1.5 text-xs">
        <LimitRow
          label="Chats"
          value={`${formatNumber(plan.chatLimit)}/mo`}
        />
        <LimitRow
          label="Leads"
          value={`${formatNumber(plan.leadLimit)}/mo`}
        />
        <LimitRow
          label="KB items"
          value={formatNumber(plan.kbLimit)}
        />
        <LimitRow
          label="Tickets"
          value={`${formatNumber(plan.ticketLimit)}/mo`}
        />
        <LimitRow
          label="Documents"
          value={formatNumber(plan.documentLimit)}
        />
        <LimitRow
          label="Automations"
          value={formatNumber(plan.automationLimit)}
        />
        <LimitRow
          label="Team seats"
          value={formatNumber(plan.seatLimit)}
        />
        <LimitRow
          label="Quotes"
          value={`${formatNumber(plan.quoteLimit)}/mo`}
        />
      </div>

      {/* Features */}
      {features.length > 0 && (
        <>
          <Separator className="my-4" />
          <ul className="space-y-2 text-xs flex-1">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-[#4d7c0f] shrink-0 mt-0.5" />
                <span className="text-foreground/90 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Action */}
      <div className="mt-5 pt-1">
        {isCurrent ? (
          <Button variant="outline" className="w-full" disabled>
            <Check className="h-4 w-4" />
            Current Plan
          </Button>
        ) : (
          <Button
            variant={actionLabel === "upgrade" ? "default" : "outline"}
            className="w-full"
            onClick={() => onSelect(plan)}
          >
            {actionLabel === "upgrade" ? (
              <>
                <TrendingUp className="h-4 w-4" />
                Upgrade
              </>
            ) : actionLabel === "downgrade" ? (
              "Downgrade"
            ) : (
              "Switch Plan"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ── Change plan dialog (P2-SUB enhanced) ────────────────────────────────

type ChangePlanStep = "form" | "awaiting" | "success";

function ChangePlanDialog({
  open,
  onOpenChange,
  targetPlan,
  currentPlan,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: PlanInfo | null;
  currentPlan: PlanInfo | null;
  onConfirm: () => void;
}) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(
    "monthly",
  );
  const [paymentMethod, setPaymentMethod] = useState<string>("paystack");
  const [step, setStep] = useState<ChangePlanStep>("form");
  const [initPayment, setInitPayment] = useState<InitPaymentRecord | null>(
    null,
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setBillingCycle("monthly");
      setPaymentMethod("paystack");
      setStep("form");
      setInitPayment(null);
      setInvoiceNumber(null);
      setProviderNote(null);
      setBusy(false);
    }
  }, [open]);

  const fromName = currentPlan ? planLabel(currentPlan.name) : "—";
  const fromPriceMonthly = currentPlan?.priceUsd ?? 0;
  const toName = targetPlan ? planLabel(targetPlan.name) : "—";
  const toPriceMonthly = targetPlan?.priceUsd ?? 0;
  const isFree = toPriceMonthly === 0;

  const toPrice =
    billingCycle === "annual" ? annualPrice(toPriceMonthly) : toPriceMonthly;
  const fromPrice =
    billingCycle === "annual"
      ? annualPrice(fromPriceMonthly)
      : fromPriceMonthly;
  const diff = toPrice - fromPrice;
  const direction = diff > 0 ? "upgrade" : diff < 0 ? "downgrade" : "switch";

  const isManualProvider =
    paymentMethod === "bank_transfer" || paymentMethod === "manual";

  async function handleProceed() {
    if (!targetPlan) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: targetPlan.name,
          provider: paymentMethod,
          billingCycle,
        }),
      });
      if (!res.ok) {
        let msg = `Failed to initialize payment (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
          else if (j?.message) msg = j.message;
        } catch {
          // ignore parse error
        }
        toast.error(msg);
        return;
      }
      const data: InitializeResponse = await res.json();

      // Free plan — server already switched the subscription
      if (!data.payment || data.redirected) {
        setInitPayment(null);
        setInvoiceNumber(null);
        setStep("success");
        toast.success(
          data.message || `Switched to ${planLabel(targetPlan.name)} plan`,
        );
        return;
      }

      setInitPayment(data.payment);
      setProviderNote(data.note ?? null);

      // For paystack / flutterwave, open the checkout page in a new tab
      if (
        data.paymentUrl &&
        (paymentMethod === "paystack" || paymentMethod === "flutterwave")
      ) {
        window.open(data.paymentUrl, "_blank");
        toast.info("Redirecting to payment…", {
          description:
            "Complete your payment in the new tab, then return here to confirm.",
        });
      } else {
        toast.info("Payment initialized", {
          description:
            "Use the reference below to complete your transfer, then confirm.",
        });
      }

      setStep("awaiting");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!initPayment) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: initPayment.reference,
          status: "success",
        }),
      });
      if (!res.ok) {
        let msg = `Verification failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
          else if (j?.message) msg = j.message;
        } catch {
          // ignore parse error
        }
        toast.error(msg);
        return;
      }
      const data: VerifyResponse = await res.json();
      setInvoiceNumber(data.invoice?.invoiceNumber ?? null);
      setStep("success");
      toast.success("Payment verified successfully", {
        description: data.message,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function handleDone() {
    onConfirm();
  }

  const proceedLabel = isFree
    ? "Switch to Free Plan"
    : direction === "upgrade"
    ? "Proceed to Payment"
    : direction === "downgrade"
    ? "Proceed to Downgrade"
    : "Proceed to Payment";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {step === "success" ? "Payment Complete" : "Change Plan"}
          </DialogTitle>
          <DialogDescription>
            {step === "success"
              ? "Your subscription has been updated."
              : "Confirm your plan change and choose a payment method."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: form ───────────────────────────────────── */}
        {step === "form" && targetPlan && (
          <div className="space-y-4">
            {/* From → To summary */}
            <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">From</span>
                <span className="font-medium">
                  {fromName} · ${formatMoney(fromPriceMonthly)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">To</span>
                <span className="font-semibold">
                  {toName} · ${formatMoney(toPriceMonthly)}/mo
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Price change</span>
                <Badge
                  className={
                    diff > 0
                      ? "bg-primary text-primary-foreground"
                      : diff < 0
                      ? "bg-accent/30 text-[#4d7c0f]"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {diff > 0
                    ? `+${formatMoneyWithCurrency(diff)}`
                    : diff < 0
                    ? `-${formatMoneyWithCurrency(Math.abs(diff))}`
                    : "No change"}
                  <span className="text-[10px] opacity-80 ml-1">
                    /{billingCycle === "annual" ? "yr" : "mo"}
                  </span>
                </Badge>
              </div>
            </div>

            {/* Billing cycle toggle */}
            {!isFree && (
              <div className="space-y-1.5">
                <Label>Billing cycle</Label>
                <Tabs
                  value={billingCycle}
                  onValueChange={(v) =>
                    setBillingCycle(v as "monthly" | "annual")
                  }
                >
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="monthly">Monthly</TabsTrigger>
                    <TabsTrigger value="annual" className="gap-1.5">
                      Annual
                      <Badge className="bg-accent/30 text-[#4d7c0f] text-[10px] h-4 px-1">
                        -20%
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {billingCycle === "annual" ? (
                  <p className="text-xs text-muted-foreground">
                    Billed annually at{" "}
                    <span className="font-medium text-foreground">
                      {formatMoneyWithCurrency(toPrice)}
                    </span>
                    /yr (
                    {formatMoneyWithCurrency(toPrice / 12)}/mo equivalent). You
                    save{" "}
                    <span className="font-medium text-[#4d7c0f]">
                      {formatMoneyWithCurrency(annualSavings(toPriceMonthly))}
                    </span>
                    /yr.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Billed monthly at{" "}
                    <span className="font-medium text-foreground">
                      {formatMoneyWithCurrency(toPrice)}
                    </span>
                    /mo. Switch to annual to save 20%.
                  </p>
                )}
              </div>
            )}

            {/* Payment method */}
            {!isFree && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-method">Payment method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="pay-method" className="w-full">
                    <SelectValue placeholder="Choose a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Security / flow note */}
            <Alert className="border-primary/20 bg-primary/5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <AlertDescription className="text-xs">
                {isFree
                  ? "No payment is required for the Free plan — your subscription will switch immediately."
                  : "Payments are processed securely. Paystack/Flutterwave redirect to the provider's checkout; bank transfer shows account details to complete the transfer."}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* ── Step: awaiting payment ──────────────────────── */}
        {step === "awaiting" && targetPlan && initPayment && (
          <div className="space-y-4">
            {/* Plan + payment summary */}
            <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-semibold">
                  {toName} ·{" "}
                  <span className="capitalize">{billingCycle}</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount due</span>
                <span className="font-semibold">
                  {formatMoneyWithCurrency(
                    initPayment.amount,
                    initPayment.currency,
                  )}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs">
                  {initPayment.reference}
                </span>
              </div>
            </div>

            {/* Bank transfer / manual: show bank details */}
            {isManualProvider ? (
              <BankTransferPanel reference={initPayment.reference} />
            ) : (
              <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700/40">
                <ExternalLink className="h-4 w-4" />
                <AlertTitle>Complete your payment</AlertTitle>
                <AlertDescription>
                  A checkout page has been opened in a new tab. Complete your
                  payment there, then click the button below to verify and
                  activate your subscription.
                </AlertDescription>
              </Alert>
            )}

            {providerNote && (
              <p className="text-xs text-muted-foreground italic">
                {providerNote}
              </p>
            )}
          </div>
        )}

        {/* ── Step: success ───────────────────────────────── */}
        {step === "success" && targetPlan && (
          <div className="space-y-4 text-center py-2">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
              <div className="text-lg font-semibold">
                {isFree ? `Switched to ${toName} plan` : "Payment Successful!"}
              </div>
              <p className="text-sm text-muted-foreground">
                Your {toName} subscription is now active.
              </p>
            </div>
            {invoiceNumber && (
              <div className="rounded-lg border bg-muted/40 p-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5" />
                  Invoice
                </span>
                <span className="font-mono text-sm font-semibold">
                  {invoiceNumber}
                </span>
              </div>
            )}
            {isFree && (
              <p className="text-xs text-muted-foreground">
                No payment was required for this plan.
              </p>
            )}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────── */}
        <DialogFooter className="gap-2">
          {step === "form" && (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={handleProceed} disabled={busy || !targetPlan}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Initializing…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    {proceedLabel}
                  </>
                )}
              </Button>
            </>
          )}

          {step === "awaiting" && (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={handleVerify} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : isManualProvider ? (
                  <>
                    <Check className="h-4 w-4" />
                    I&rsquo;ve Made the Transfer
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    I&rsquo;ve Completed Payment
                  </>
                )}
              </Button>
            </>
          )}

          {step === "success" && (
            <Button onClick={handleDone} className="w-full">
              <Check className="h-4 w-4" />
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Trial banner (P2-SUB) ────────────────────────────────────────────────

function TrialBanner({
  daysRemaining,
  trialEndsAt,
  onUpgrade,
}: {
  daysRemaining: number;
  trialEndsAt: string | null;
  onUpgrade: () => void;
}) {
  const endLabel = formatDate(trialEndsAt);
  return (
    <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700/40">
      <Clock className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        You&rsquo;re on a trial period
        <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">
          {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
        </Badge>
      </AlertTitle>
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
        <span>
          {endLabel
            ? `Your trial ends on ${endLabel}. Upgrade now to keep your features.`
            : "Upgrade now to keep your features after the trial ends."}
        </span>
        <Button
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 gap-1.5"
          onClick={onUpgrade}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Upgrade Now
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ── Payment status banner (P2-SUB) ───────────────────────────────────────

function PaymentStatusBanner({
  status,
  onReactivate,
}: {
  status: string;
  onReactivate: () => void;
}) {
  if (status === "past_due") {
    return (
      <div className="bg-destructive/10 border-b border-destructive/30 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            Your subscription is past due. Please update your payment method.
          </span>
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={onReactivate}
          className="gap-1.5 shrink-0"
        >
          <CreditCard className="h-3.5 w-3.5" />
          Update Payment
        </Button>
      </div>
    );
  }
  if (status === "canceled" || status === "expired") {
    return (
      <div className="bg-destructive/10 border-b border-destructive/30 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            Your subscription has expired. Reactivate now.
          </span>
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={onReactivate}
          className="gap-1.5 shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reactivate Now
        </Button>
      </div>
    );
  }
  return null;
}

// ── Bank transfer details panel (P2-SUB) ─────────────────────────────────

function BankTransferPanel({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      toast.success("Reference copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy reference");
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Building2 className="h-4 w-4" />
        Bank Transfer Instructions
      </div>
      <div className="space-y-2 text-sm">
        <BankDetailRow label="Bank" value={BANK_DETAILS.bank} />
        <BankDetailRow
          label="Account Name"
          value={BANK_DETAILS.accountName}
        />
        <BankDetailRow
          label="Account Number"
          value={BANK_DETAILS.accountNumber}
          mono
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Reference</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs bg-background px-2 py-1 rounded border">
              {reference}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={copyRef}
              type="button"
            >
              {copied ? (
                <Check className="h-3 w-3 text-[#4d7c0f]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
      <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700/40">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Use the reference as the transfer description. After transfer, click
          &ldquo;I&rsquo;ve Made the Transfer&rdquo; to confirm.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function BankDetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// ── Invoice history (P2-SUB) ─────────────────────────────────────────────

function InvoiceHistory({
  invoices,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  invoices: InvoiceRecord[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (invoice: InvoiceRecord) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Invoice History
          </CardTitle>
          <CardDescription>
            Invoices are generated automatically when you make a payment.
          </CardDescription>
        </div>
        {invoices.length > 0 && (
          <Badge variant="secondary" className="shrink-0">
            {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <InvoiceHistorySkeleton />
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : invoices.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No invoices yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Invoices are generated automatically when you make a payment.
            </p>
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Method
                  </TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => {
                  const sm = invoiceStatusMeta(inv.status);
                  const methodLabel = inv.payment
                    ? paymentLabel(inv.payment.provider)
                    : null;
                  return (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onSelect(inv)}
                    >
                      <TableCell className="font-mono text-xs font-medium">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(inv.createdAt) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        {formatMoneyWithCurrency(inv.amount, inv.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge className={sm.className}>{sm.label}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {methodLabel ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            title={`Download ${inv.invoiceNumber}.pdf`}
                            aria-label={`Download ${inv.invoiceNumber} as PDF`}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                `/api/invoices/${inv.id}/pdf`,
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceHistorySkeleton() {
  return (
    <div className="rounded-md border">
      <div className="h-10 border-b bg-muted/40 flex items-center px-4">
        <Skeleton className="h-4 w-full" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-12 border-b last:border-b-0 flex items-center px-4 gap-4"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Invoice detail dialog (P2-SUB) ───────────────────────────────────────

function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!invoice) return null;
  const sm = invoiceStatusMeta(invoice.status);
  const created = formatDateTime(invoice.createdAt);
  const paidAt = formatDateTime(invoice.paidAt);
  const dueDate = formatDate(invoice.dueDate);
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Invoice {invoice.invoiceNumber}
          </DialogTitle>
          <DialogDescription>
            Invoice details and payment information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status + invoice number */}
          <div className="flex items-center justify-between">
            <Badge className={sm.className}>{sm.label}</Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {invoice.invoiceNumber}
            </span>
          </div>

          {/* Key-value grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Issued
              </div>
              <div className="font-medium">{created ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                {invoice.status === "paid" ? "Paid" : "Due"}
              </div>
              <div className="font-medium">
                {(invoice.status === "paid" ? paidAt : dueDate) ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Payment method
              </div>
              <div className="font-medium">
                {invoice.payment
                  ? paymentLabel(invoice.payment.provider)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Payment status
              </div>
              <div className="font-medium">
                {invoice.payment
                  ? invoice.payment.status.charAt(0).toUpperCase() +
                    invoice.payment.status.slice(1)
                  : "—"}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-lg border">
            <div className="bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Line items
            </div>
            <ScrollArea className="max-h-48">
              <div className="divide-y">
                {items.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    No line items.
                  </div>
                ) : (
                  items.map((item, i) => (
                    <div
                      key={i}
                      className="px-3 py-2.5 flex items-start justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {item.description ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Qty {item.quantity ?? 1} ×{" "}
                          {formatMoneyWithCurrency(
                            item.unitPrice ?? 0,
                            invoice.currency,
                          )}
                        </div>
                      </div>
                      <div className="font-semibold tabular-nums shrink-0">
                        {formatMoneyWithCurrency(
                          item.total ?? 0,
                          invoice.currency,
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="border-t bg-muted/40 px-3 py-2.5 flex items-center justify-between">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-base font-bold tabular-nums">
                {formatMoneyWithCurrency(invoice.amount, invoice.currency)}
              </span>
            </div>
          </div>

          {/* Payment reference */}
          {invoice.payment && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Payment reference</span>
              <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                {invoice.payment.reference}
              </span>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              <div className="font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Notes
              </div>
              <div className="text-foreground/90">{invoice.notes}</div>
            </div>
          )}

          <Alert className="border-primary/20 bg-primary/5">
            <Download className="h-4 w-4 text-primary" />
            <AlertDescription className="text-xs">
              Download a PDF copy of this invoice for your records.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button
              className="flex-1"
              onClick={() =>
                window.open(
                  `/api/invoices/${invoice.id}/pdf`,
                  "_blank",
                  "noopener,noreferrer"
                )
              }
            >
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Security note ────────────────────────────────────────────────────────

function SecurityNote() {
  return (
    <Alert className="border-primary/20 bg-primary/5">
      <ShieldCheck className="h-4 w-4 text-primary" />
      <AlertTitle className="text-primary">Secure payments</AlertTitle>
      <AlertDescription>
        Payment is processed securely through your chosen provider. We never
        store card details.
      </AlertDescription>
    </Alert>
  );
}

// ── Loading skeletons ────────────────────────────────────────────────────

function CurrentPlanSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UsageSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="space-y-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PlansGridSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-80" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border bg-card p-5 space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
              <Skeleton className="h-px w-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-px w-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
