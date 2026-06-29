"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CreditCard,
  Crown,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
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
import { Input } from "@/components/ui/input";
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
}

interface UsageStats {
  chats: number;
  leads: number;
  kbItems: number;
  aiRequests: number;
}

interface SubscriptionData {
  subscription: SubscriptionRecord;
  plan: PlanInfo | null;
  usage: UsageStats;
  allPlans: PlanInfo[];
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

  useEffect(() => {
    load();
  }, [load]);

  const currentPlan = useMemo<PlanInfo | null>(() => {
    if (!data) return null;
    if (data.plan) return data.plan;
    // Fallback: find the plan matching the subscription's planName
    return (
      data.allPlans.find((p) => p.name === data.subscription.planName) ?? null
    );
  }, [data]);

  function openChangeDialog(plan: PlanInfo) {
    setTargetPlan(plan);
    setDialogOpen(true);
  }

  function handleChangeSuccess() {
    setDialogOpen(false);
    setTargetPlan(null);
    load();
  }

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
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
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
          {/* Current plan card */}
          <CurrentPlanCard
            subscription={data.subscription}
            plan={currentPlan}
          />

          {/* Usage this month */}
          <UsageThisMonth usage={data.usage} plan={currentPlan} />

          {/* Plan comparison */}
          <PlanComparisonGrid
            plans={data.allPlans}
            currentPlanName={data.subscription.planName}
            currentPriceUsd={currentPlan?.priceUsd ?? 0}
            onSelect={openChangeDialog}
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
    </div>
  );
}

// ── Current plan card ────────────────────────────────────────────────────

function CurrentPlanCard({
  subscription,
  plan,
}: {
  subscription: SubscriptionRecord;
  plan: PlanInfo | null;
}) {
  const meta = statusMeta(subscription.status);
  const startDate = formatDate(subscription.startDate);
  const endDate = formatDate(subscription.endDate);
  const trialEnd = formatDate(subscription.trialEndsAt);
  const payLabel = paymentLabel(subscription.paymentMethod);

  return (
    <Card className="overflow-hidden border-primary/20">
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

// ── Change plan dialog ───────────────────────────────────────────────────

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
  const [paymentMethod, setPaymentMethod] =
    useState<string>("paystack");
  const [paymentRef, setPaymentRef] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setPaymentMethod("paystack");
      setPaymentRef("");
      setSaving(false);
    }
  }, [open]);

  const fromName = currentPlan ? planLabel(currentPlan.name) : "—";
  const fromPrice = currentPlan?.priceUsd ?? 0;
  const toName = targetPlan ? planLabel(targetPlan.name) : "—";
  const toPrice = targetPlan?.priceUsd ?? 0;
  const diff = toPrice - fromPrice;
  const direction =
    diff > 0 ? "upgrade" : diff < 0 ? "downgrade" : "switch";

  async function handleConfirm() {
    if (!targetPlan) return;
    setSaving(true);
    try {
      const res = await fetch("/api/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: targetPlan.name,
          paymentMethod,
          paymentRef: paymentRef.trim() || null,
          status: "active",
        }),
      });
      if (!res.ok) {
        let msg = `Failed to update plan (${res.status})`;
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
      toast.success(`Plan changed to ${planLabel(targetPlan.name)}`, {
        description:
          diff > 0
            ? `+$${formatMoney(diff)}/mo — effective immediately.`
            : diff < 0
            ? `-$${formatMoney(Math.abs(diff))}/mo — effective immediately.`
            : "Your new plan is now active.",
      });
      onConfirm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Change Plan
          </DialogTitle>
          <DialogDescription>
            Confirm your plan change and record a payment method.
          </DialogDescription>
        </DialogHeader>

        {targetPlan && (
          <div className="space-y-4">
            {/* From → To summary */}
            <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">From</span>
                <span className="font-medium">
                  {fromName} · ${formatMoney(fromPrice)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">To</span>
                <span className="font-semibold">
                  {toName} · ${formatMoney(toPrice)}/mo
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
                    ? `+$${formatMoney(diff)}/mo`
                    : diff < 0
                    ? `-$${formatMoney(Math.abs(diff))}/mo`
                    : "No change"}
                </Badge>
              </div>
            </div>

            {/* Payment method */}
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

            {/* Payment reference */}
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">
                Payment reference{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="pay-ref"
                placeholder="e.g. txn_abc123, transfer ref, receipt no."
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                Used for manual reconciliation. Leave blank if not applicable.
              </p>
            </div>

            {/* Manual tracking note */}
            <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700/40">
              <Info className="h-4 w-4" />
              <AlertTitle>Payment gateway integration is coming soon</AlertTitle>
              <AlertDescription>
                For now, plans are changed manually with payment tracking. Our
                team will verify your payment before activating premium features.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving || !targetPlan}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirming…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Confirm {direction === "upgrade" ? "Upgrade" : direction === "downgrade" ? "Downgrade" : "Change"}
              </>
            )}
          </Button>
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
