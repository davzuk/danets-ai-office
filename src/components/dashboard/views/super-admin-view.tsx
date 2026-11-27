"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Shield,
  ShieldAlert,
  Building2,
  CheckCircle2,
  Users,
  TrendingUp,
  MessageSquare,
  Zap,
  DollarSign,
  Ticket,
  Search,
  RefreshCw,
  MoreVertical,
  Eye,
  Ban,
  CheckCircle,
  ArrowRightCircle,
  Loader2,
  Mail,
  Calendar,
  Cpu,
  CircleDollarSign,
  Crown,
  ExternalLink,
  FileText,
  BookOpen,
  LayoutDashboard,
  Receipt,
  CreditCard,
  Plus,
  Trash2,
  LogIn,
  KeyRound,
  Gauge,
  History,
  Settings2,
  Download,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  SuperAdminSubscriptionsPanel,
  SuperAdminPaymentsPanel,
  SuperAdminInvoicesPanel,
} from "@/components/dashboard/views/super-admin-billing-panels";
import { SuperAdminUsagePanel, UsageQuotaSummary } from "@/components/dashboard/views/super-admin-usage-panel";
import { TenantLimitOverrides } from "@/components/dashboard/views/tenant-limit-overrides";
import { SuperAdminHealthPanel } from "@/components/dashboard/views/super-admin-health-panel";
import { TenantWhiteLabelEditor } from "@/components/dashboard/views/tenant-white-label-editor";
import { TenantTwoFactorPolicy } from "@/components/dashboard/views/tenant-two-factor-policy";
import { TenantWidgetOrigins } from "@/components/dashboard/views/tenant-widget-origins";
import { TenantSeoCard } from "@/components/dashboard/views/tenant-seo-card";
import type { PlatformTabId } from "@/lib/platform-nav";
import { SuperAdminUsersPanel } from "@/components/dashboard/views/super-admin-users-panel";
import { SuperAdminAuditPanel } from "@/components/dashboard/views/super-admin-audit-panel";
import { SuperAdminSitesPanel } from "@/components/dashboard/views/super-admin-sites-panel";
import {
  SuperAdminPlatformPanel,
  exportTenantsCsv,
} from "@/components/dashboard/views/super-admin-platform-panels";
import {
  CmsPagesPanel,
  CmsPostsPanel,
  CmsNavPanel,
  CmsBlocksPanel,
  CmsMediaPanel,
  CmsContactsPanel,
  CmsSitePanel,
} from "@/components/dashboard/views/cms-admin-views";

// ─── Types ───────────────────────────────────────────────────────

export interface SuperAdminUser {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
  isSuperAdmin: boolean;
}

type Plan = "free" | "starter" | "pro" | "enterprise";
type Status = "active" | "suspended";

interface StatsData {
  totals: {
    businesses: number;
    activeBusinesses: number;
    suspendedBusinesses: number;
    users: number;
    leads: number;
    chats: number;
    tickets: number;
    proposals: number;
    aiRequests: number;
    aiTokens: number;
    aiCostUsd: number;
  };
  plansBreakdown: { plan: string; count: number }[];
  revenue?: {
    mrr: number;
    arr: number;
    totalRevenue: number;
    successfulPayments: number;
    failedPayments: number;
    pendingPayments: number;
    paidInvoicesTotal: number;
    paidInvoicesCount: number;
    mrrByPlan: { plan: string; amount: number }[];
    paymentsByStatus: { status: string; count: number; amount: number }[];
  };
  recentBusinesses: {
    id: string;
    name: string;
    email: string;
    plan: string;
    status: string;
    createdAt: string;
  }[];
}

interface BusinessRow {
  id: string;
  name: string;
  email: string | null;
  industry: string | null;
  plan: string;
  status: string;
  publicKey: string;
  createdAt: string;
  stats: {
    users: number;
    leads: number;
    chats: number;
    tickets: number;
    proposals: number;
    aiRequests: number;
  };
  aiUsage: {
    tokens: number;
    costUsd: number;
    requests: number;
  };
}

interface BusinessDetail {
  id: string;
  name: string;
  email: string | null;
  publicKey: string;
  industry: string | null;
  phone: string | null;
  whatsapp: string | null;
  plan: string;
  status: string;
  enforce2fa?: boolean;
  widgetAllowedOrigins?: string[] | null;
  createdAt: string;
  updatedAt: string;
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    isSuperAdmin: boolean;
    createdAt: string;
  }[];
  subscription: {
    id: string;
    plan: string;
    status: string;
    monthlyFee: number;
    startDate: string;
    endDate: string | null;
    trialEndsAt: string | null;
    paymentMethod: string | null;
    paymentRef: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  _count: {
    leads: number;
    chatSessions: number;
    supportTickets: number;
    quoteRequests: number;
    knowledgeBaseItems: number;
    documents: number;
    usageLogs: number;
  };
  usage?: {
    chats: number;
    leads: number;
    kbItems: number;
    agents: number;
    aiRequests: number;
    limits: {
      chatLimit: number;
      leadLimit: number;
      kbLimit: number;
      agentLimit: number;
      aiLimit: number;
    };
    percent: {
      chats: number;
      leads: number;
      kbItems: number;
      agents: number;
      aiRequests: number;
    };
  };
  limitOverride?: {
    chatLimit: number | null;
    leadLimit: number | null;
    kbLimit: number | null;
    agentLimit: number | null;
    notes: string | null;
  } | null;
}

// ─── Plan metadata ───────────────────────────────────────────────

const PLAN_META: Record<string, { label: string; color: string; badgeClass: string; barClass: string }> = {
  free: {
    label: "Free",
    color: "#64748b",
    badgeClass: "bg-muted text-muted-foreground border-transparent",
    barClass: "[&_[data-slot=progress-indicator]]:bg-slate-400",
  },
  starter: {
    label: "Starter",
    color: "#1d4ed8",
    badgeClass: "bg-primary text-primary-foreground border-transparent",
    barClass: "[&_[data-slot=progress-indicator]]:bg-primary",
  },
  pro: {
    label: "Pro",
    color: "#84cc16",
    badgeClass: "bg-accent text-accent-foreground border-transparent",
    barClass: "[&_[data-slot=progress-indicator]]:bg-accent",
  },
  enterprise: {
    label: "Enterprise",
    color: "#7c3aed",
    badgeClass: "bg-violet-600 text-white border-transparent hover:bg-violet-600",
    barClass: "[&_[data-slot=progress-indicator]]:bg-violet-600",
  },
};

function planMeta(plan: string) {
  return (
    PLAN_META[plan] ?? {
      label: plan || "Unknown",
      color: "#64748b",
      badgeClass: "bg-muted text-muted-foreground",
      barClass: "[&_[data-slot=progress-indicator]]:bg-slate-400",
    }
  );
}

const PLAN_ORDER: string[] = ["free", "starter", "pro", "enterprise"];

// ─── Format helpers ──────────────────────────────────────────────

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCost(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoney(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Main component ──────────────────────────────────────────────

export function SuperAdminView({
  user,
  onSessionChange,
  activeTab,
  onTabChange,
}: {
  user: SuperAdminUser;
  onSessionChange?: (user: SuperAdminUser) => void;
  activeTab: PlatformTabId;
  onTabChange?: (tab: PlatformTabId) => void;
}) {
  // Guard: only super admins may view this.
  if (!user?.isSuperAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-3">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">Forbidden</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              You do not have permission to view the Super Admin Dashboard.
              This area is restricted to Danets TecPro internal super admins.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <SuperAdminInner
      activeTab={activeTab}
      onTabChange={onTabChange}
      onSessionChange={onSessionChange}
    />
  );
}

function SuperAdminInner({
  activeTab,
  onTabChange,
  onSessionChange,
}: {
  activeTab: PlatformTabId;
  onTabChange?: (tab: PlatformTabId) => void;
  onSessionChange?: (user: SuperAdminUser) => void;
}) {
  const [stats, setStats] = React.useState<StatsData | null>(null);
  const [businesses, setBusinesses] = React.useState<BusinessRow[]>([]);
  const [statsLoading, setStatsLoading] = React.useState(true);
  const [listLoading, setListLoading] = React.useState(true);
  const [statsError, setStatsError] = React.useState<string | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [planFilter, setPlanFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const mainTab = activeTab;
  const setMainTab = (tab: string) => onTabChange?.(tab as PlatformTabId);

  // Detail dialog state
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<BusinessDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  // Suspend/activate confirmation
  const [toggleTarget, setToggleTarget] = React.useState<BusinessRow | null>(null);
  const [toggling, setToggling] = React.useState(false);

  // Create tenant
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({
    businessName: "",
    industry: "",
    email: "",
    plan: "free" as Plan,
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });

  // Delete tenant
  const [deleteTarget, setDeleteTarget] = React.useState<BusinessRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Password reset in detail dialog
  const [resetUserId, setResetUserId] = React.useState<string | null>(null);
  const [resetPassword, setResetPassword] = React.useState("");
  const [resetting, setResetting] = React.useState(false);

  // Refresh stats
  async function loadStats() {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/super-admin/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = (await res.json()) as StatsData;
      setStats(json);
    } catch (e: any) {
      setStatsError(e?.message || "Network error");
    } finally {
      setStatsLoading(false);
    }
  }

  // Refresh businesses list
  async function loadBusinesses() {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (planFilter !== "all") params.set("plan", planFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const url = `/api/super-admin/businesses${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = (await res.json()) as { businesses: BusinessRow[] };
      setBusinesses(json.businesses || []);
    } catch (e: any) {
      setListError(e?.message || "Network error");
    } finally {
      setListLoading(false);
    }
  }

  // Initial stats load
  React.useEffect(() => {
    loadStats();
  }, []);

  // Debounced search
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Refetch list on filter/debounce changes
  React.useEffect(() => {
    loadBusinesses();
  }, [debounced, planFilter, statusFilter]);

  // Load detail on open
  React.useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/super-admin/businesses/${detailId}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed (${r.status})`);
        const json = await r.json();
        setDetail(json.business as BusinessDetail);
      })
      .catch((e) => toast.error(e?.message || "Failed to load business details"))
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  // Toggle status (suspend / activate)
  async function confirmToggle() {
    if (!toggleTarget) return;
    const nextStatus: Status = toggleTarget.status === "active" ? "suspended" : "active";
    setToggling(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${toggleTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(
        `${toggleTarget.name} ${nextStatus === "suspended" ? "suspended" : "activated"} successfully`
      );
      // Optimistically update both lists
      setBusinesses((prev) =>
        prev.map((b) => (b.id === toggleTarget.id ? { ...b, status: nextStatus } : b))
      );
      setStats((prev) =>
        prev
          ? {
              ...prev,
              totals: {
                ...prev.totals,
                activeBusinesses:
                  prev.totals.activeBusinesses + (nextStatus === "active" ? 1 : -1),
                suspendedBusinesses:
                  prev.totals.suspendedBusinesses + (nextStatus === "suspended" ? 1 : -1),
              },
            }
          : prev
      );
      setToggleTarget(null);
      // Refresh stats in background to keep counts accurate
      loadStats();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update business");
    } finally {
      setToggling(false);
    }
  }

  // Change plan
  async function changePlan(business: BusinessRow, plan: Plan) {
    if (business.plan === plan) return;
    const prevPlan = business.plan;
    // Optimistic
    setBusinesses((prev) =>
      prev.map((b) => (b.id === business.id ? { ...b, plan } : b))
    );
    try {
      const res = await fetch(`/api/super-admin/businesses/${business.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`${business.name} moved to ${planMeta(plan).label} plan`);
      // Refresh stats (plans breakdown)
      loadStats();
    } catch (e: any) {
      // Revert
      setBusinesses((prev) =>
        prev.map((b) => (b.id === business.id ? { ...b, plan: prevPlan } : b))
      );
      toast.error(e?.message || "Failed to update plan");
    }
  }

  async function createTenant() {
    if (
      !createForm.businessName.trim() ||
      !createForm.adminName.trim() ||
      !createForm.adminEmail.trim() ||
      createForm.adminPassword.length < 6
    ) {
      toast.error("Fill in all required fields (password min. 6 chars)");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/super-admin/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: createForm.businessName.trim(),
          industry: createForm.industry.trim() || undefined,
          email: createForm.email.trim() || undefined,
          plan: createForm.plan,
          adminName: createForm.adminName.trim(),
          adminEmail: createForm.adminEmail.trim(),
          adminPassword: createForm.adminPassword,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`Tenant "${createForm.businessName}" created`);
      setCreateOpen(false);
      setCreateForm({
        businessName: "",
        industry: "",
        email: "",
        plan: "free",
        adminName: "",
        adminEmail: "",
        adminPassword: "",
      });
      loadBusinesses();
      loadStats();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`Deleted ${deleteTarget.name}`);
      setBusinesses((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      if (detailId === deleteTarget.id) setDetailId(null);
      setDeleteTarget(null);
      loadStats();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete tenant");
    } finally {
      setDeleting(false);
    }
  }

  async function impersonateUser(userId: string, businessId: string, label: string) {
    try {
      const res = await fetch("/api/super-admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, businessId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      toast.success(`Now impersonating ${label}`);
      onSessionChange?.(data.user);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Impersonation failed");
    }
  }

  async function resetUserPassword() {
    if (!resetUserId || resetPassword.length < 6) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/super-admin/users/${resetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success("Password reset successfully");
      setResetUserId(null);
      setResetPassword("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      {mainTab === "overview" && (
        <div className="space-y-6">
      {/* Revenue row */}
      {!statsLoading && stats?.revenue && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="MRR"
            value={fmtMoney(stats.revenue.mrr)}
            icon={<CircleDollarSign className="h-4 w-4" />}
            accent="emerald"
            hint={`ARR ${fmtMoney(stats.revenue.arr)}`}
          />
          <StatCard
            label="Total Revenue"
            value={fmtMoney(stats.revenue.totalRevenue)}
            icon={<DollarSign className="h-4 w-4" />}
            accent="blue"
            hint={`${stats.revenue.successfulPayments} payments`}
          />
          <StatCard
            label="Pending Payments"
            value={String(stats.revenue.pendingPayments)}
            icon={<CreditCard className="h-4 w-4" />}
            accent="amber"
            hint={`${stats.revenue.failedPayments} failed`}
          />
          <StatCard
            label="Paid Invoices"
            value={fmtMoney(stats.revenue.paidInvoicesTotal)}
            icon={<FileText className="h-4 w-4" />}
            accent="violet"
            hint={`${stats.revenue.paidInvoicesCount} invoices`}
          />
        </div>
      )}

      {/* System stats row */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : statsError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm text-destructive flex items-center justify-between">
            <span>{statsError}</span>
            <Button size="sm" variant="outline" onClick={loadStats} className="gap-1.5">
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Businesses"
            value={formatNumber(stats?.totals.businesses ?? 0)}
            icon={<Building2 className="h-4 w-4" />}
            accent="blue"
            hint={`${stats?.totals.suspendedBusinesses ?? 0} suspended`}
          />
          <StatCard
            label="Active Businesses"
            value={formatNumber(stats?.totals.activeBusinesses ?? 0)}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="emerald"
            hint="Currently live"
          />
          <StatCard
            label="Total Users"
            value={formatNumber(stats?.totals.users ?? 0)}
            icon={<Users className="h-4 w-4" />}
            accent="accent"
            hint="Across all tenants"
          />
          <StatCard
            label="Total Leads"
            value={formatNumber(stats?.totals.leads ?? 0)}
            icon={<TrendingUp className="h-4 w-4" />}
            accent="amber"
            hint="All-time captured"
          />
          <StatCard
            label="Total Chats"
            value={formatNumber(stats?.totals.chats ?? 0)}
            icon={<MessageSquare className="h-4 w-4" />}
            accent="violet"
            hint="Chat sessions"
          />
          <StatCard
            label="AI Requests"
            value={formatNumber(stats?.totals.aiRequests ?? 0)}
            icon={<Zap className="h-4 w-4" />}
            accent="cyan"
            hint={formatCompact(stats?.totals.aiTokens ?? 0) + " tokens"}
          />
          <StatCard
            label="AI Cost"
            value={`$${formatCost(stats?.totals.aiCostUsd ?? 0)}`}
            icon={<DollarSign className="h-4 w-4" />}
            accent="rose"
            hint="Estimated spend"
          />
          <StatCard
            label="Total Tickets"
            value={formatNumber(stats?.totals.tickets ?? 0)}
            icon={<Ticket className="h-4 w-4" />}
            accent="orange"
            hint="Support tickets"
          />
        </div>
      )}

      {/* Plans breakdown + Recent businesses */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PlansBreakdownCard
          loading={statsLoading}
          breakdown={stats?.plansBreakdown ?? []}
          total={stats?.totals.businesses ?? 0}
        />
        <RecentBusinessesCard
          loading={statsLoading}
          businesses={stats?.recentBusinesses ?? []}
          onView={setDetailId}
        />
      </div>
        </div>
      )}

      {mainTab === "tenants" && (
        <div className="space-y-6">
      {/* Businesses management table */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Businesses Management
              </CardTitle>
              <CardDescription>
                Search, filter, create, suspend, and manage any business on the platform.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Tenant
              </Button>
              <Button size="sm" variant="outline" onClick={exportTenantsCsv} className="gap-1.5">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-9 h-10"
              />
            </div>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-full sm:w-[160px] h-10">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plans</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px] h-10">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listError ? (
            <div className="px-6 pb-6 text-sm text-destructive flex items-center justify-between">
              <span>{listError}</span>
              <Button size="sm" variant="outline" onClick={loadBusinesses} className="gap-1.5">
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          ) : listLoading ? (
            <div className="px-6 pb-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : businesses.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No businesses match your filters.
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="pl-6 min-w-[220px]">Business</TableHead>
                    <TableHead className="min-w-[110px]">Plan</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                    <TableHead className="min-w-[180px]">Stats</TableHead>
                    <TableHead className="min-w-[140px]">AI Usage</TableHead>
                    <TableHead className="min-w-[100px]">Created</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {businesses.map((b) => (
                    <BusinessRowItem
                      key={b.id}
                      business={b}
                      onView={() => setDetailId(b.id)}
                      onToggle={() => setToggleTarget(b)}
                      onPlanChange={(plan) => changePlan(b, plan)}
                      onDelete={() => setDeleteTarget(b)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
        </div>
      )}

      {mainTab === "health" && (
        <SuperAdminHealthPanel
          onViewTenant={(id) => {
            setMainTab("tenants");
            setDetailId(id);
          }}
        />
      )}

      {mainTab === "usage" && <SuperAdminUsagePanel />}

      {mainTab === "sites" && <SuperAdminSitesPanel />}

      {mainTab === "users" && (
        <SuperAdminUsersPanel
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
          onImpersonate={(u) => impersonateUser(u.id, u.business.id, u.email)}
        />
      )}

      {mainTab === "audit" && (
        <SuperAdminAuditPanel
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        />
      )}

      {mainTab === "platform" && (
        <SuperAdminPlatformPanel
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        />
      )}

      {mainTab === "subscriptions" && <SuperAdminSubscriptionsPanel />}

      {mainTab === "payments" && <SuperAdminPaymentsPanel />}

      {mainTab === "invoices" && (
        <SuperAdminInvoicesPanel
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        />
      )}

      {mainTab === "cms-pages" && <CmsPagesPanel />}
      {mainTab === "cms-posts" && <CmsPostsPanel />}
      {mainTab === "cms-nav" && <CmsNavPanel />}
      {mainTab === "cms-blocks" && <CmsBlocksPanel />}
      {mainTab === "cms-media" && <CmsMediaPanel />}
      {mainTab === "cms-contacts" && <CmsContactsPanel />}
      {mainTab === "cms-site" && <CmsSitePanel />}

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Business Details
            </DialogTitle>
            <DialogDescription>
              Full business profile, team members, subscription, and usage.
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="overflow-y-auto scroll-thin pr-1 space-y-5">
              {/* Identity */}
              <div className="flex items-start gap-3">
                <Avatar className="h-12 w-12 border">
                  <AvatarFallback className="brand-gradient text-white text-base">
                    {detail.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold truncate">{detail.name}</h3>
                    <Badge className={planMeta(detail.plan).badgeClass}>
                      {planMeta(detail.plan).label}
                    </Badge>
                    <StatusBadge status={detail.status} />
                  </div>
                  {detail.email && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="h-3.5 w-3.5" />
                      {detail.email}
                    </div>
                  )}
                  {detail.industry && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Industry: {detail.industry}
                    </div>
                  )}
                </div>
              </div>

              {/* Counts grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <CountTile label="Users" value={detail.users.length} icon={<Users className="h-3.5 w-3.5" />} />
                <CountTile label="Leads" value={detail._count.leads} icon={<TrendingUp className="h-3.5 w-3.5" />} />
                <CountTile label="Chats" value={detail._count.chatSessions} icon={<MessageSquare className="h-3.5 w-3.5" />} />
                <CountTile label="Tickets" value={detail._count.supportTickets} icon={<Ticket className="h-3.5 w-3.5" />} />
                <CountTile label="Proposals" value={detail._count.quoteRequests} icon={<FileText className="h-3.5 w-3.5" />} />
                <CountTile label="KB Items" value={detail._count.knowledgeBaseItems} icon={<BookOpen className="h-3.5 w-3.5" />} />
                <CountTile label="Documents" value={detail._count.documents} icon={<FileText className="h-3.5 w-3.5" />} />
                <CountTile label="AI Logs" value={detail._count.usageLogs} icon={<Cpu className="h-3.5 w-3.5" />} />
              </div>

              {/* Subscription */}
              <div className="rounded-lg border p-3 space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5" /> Subscription
                </div>
                {detail.subscription ? (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Plan</span>
                      <Badge className={planMeta(detail.subscription.plan).badgeClass}>
                        {planMeta(detail.subscription.plan).label}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium capitalize">{detail.subscription.status}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Monthly fee</span>
                      <span className="font-medium">
                        ${detail.subscription.monthlyFee.toFixed(2)}
                      </span>
                    </div>
                    {detail.subscription.trialEndsAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Trial ends</span>
                        <span className="font-medium">
                          {formatDate(detail.subscription.trialEndsAt)}
                        </span>
                      </div>
                    )}
                    {detail.subscription.currentPeriodEnd && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Renews / ends</span>
                        <span className="font-medium">
                          {formatDate(detail.subscription.currentPeriodEnd)}
                        </span>
                      </div>
                    )}
                    {detail.subscription.paymentMethod && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Payment</span>
                        <span className="font-medium capitalize">
                          {detail.subscription.paymentMethod}
                        </span>
                      </div>
                    )}
                    {detail.subscription.cancelAtPeriodEnd && (
                      <div className="text-xs text-amber-600 dark:text-amber-500">
                        Cancellation scheduled at period end.
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No subscription record.</p>
                )}
              </div>

              {/* Public key */}
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Public Key
                </div>
                <code className="text-xs font-mono break-all">{detail.publicKey}</code>
              </div>

              {detail.usage && <UsageQuotaSummary usage={detail.usage} />}

              <TenantLimitOverrides
                businessId={detail.id}
                businessName={detail.name}
                onSaved={() => {
                  fetch(`/api/super-admin/businesses/${detail.id}`, { cache: "no-store" })
                    .then((r) => r.json())
                    .then((json) => setDetail(json.business as BusinessDetail))
                    .catch(() => {});
                }}
              />

              <TenantTwoFactorPolicy
                businessId={detail.id}
                enforce2fa={!!detail.enforce2fa}
                onChanged={() => {
                  fetch(`/api/super-admin/businesses/${detail.id}`, { cache: "no-store" })
                    .then((r) => r.json())
                    .then((json) => setDetail(json.business as BusinessDetail))
                    .catch(() => {});
                }}
              />

              <TenantWidgetOrigins
                key={`${detail.id}:${JSON.stringify(detail.widgetAllowedOrigins ?? [])}`}
                businessId={detail.id}
                origins={Array.isArray(detail.widgetAllowedOrigins) ? detail.widgetAllowedOrigins : []}
                onChanged={() => {
                  fetch(`/api/super-admin/businesses/${detail.id}`, { cache: "no-store" })
                    .then((r) => r.json())
                    .then((json) => setDetail(json.business as BusinessDetail))
                    .catch(() => {});
                }}
              />

              <TenantSeoCard key={`seo:${detail.id}`} businessId={detail.id} />

              <TenantWhiteLabelEditor businessId={detail.id} plan={detail.plan} />

              <Separator />

              {/* Users */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Team Members ({detail.users.length})
                </div>
                <div className="space-y-1.5">
                  {detail.users.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 rounded-lg p-2 bg-muted/40"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-muted text-xs">
                          {u.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {u.name}
                          {u.isSuperAdmin && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5 text-amber-600 border-amber-500/40 bg-amber-500/10">
                              <Shield className="h-2.5 w-2.5" /> Super
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize text-xs">
                        {u.role}
                      </Badge>
                      {!u.isSuperAdmin && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Impersonate"
                            onClick={() => impersonateUser(u.id, detail.id, u.email)}
                          >
                            <LogIn className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Reset password"
                            onClick={() => {
                              setResetUserId(u.id);
                              setResetPassword("");
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No data available.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend / Activate confirmation */}
      <AlertDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.status === "active" ? "Suspend" : "Activate"} {toggleTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.status === "active"
                ? "Suspending a business will block all dashboard access for its team. The business can be reactivated at any time."
                : "Activating this business will restore full dashboard access for its team."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggling}
              onClick={(e) => {
                e.preventDefault();
                confirmToggle();
              }}
              className={
                toggleTarget?.status === "active"
                  ? "bg-destructive text-white hover:bg-destructive/90"
                  : ""
              }
            >
              {toggling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {toggleTarget?.status === "active" ? "Suspend" : "Activate"} business
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create tenant */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>
              Provision a new business with an admin account, default AI agent, and subscription.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Business name *</Label>
              <Input
                value={createForm.businessName}
                onChange={(e) => setCreateForm((f) => ({ ...f, businessName: e.target.value }))}
                placeholder="Acme Corp"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Industry</Label>
                <Input
                  value={createForm.industry}
                  onChange={(e) => setCreateForm((f) => ({ ...f, industry: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select
                  value={createForm.plan}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, plan: v as Plan }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_ORDER.map((p) => (
                      <SelectItem key={p} value={p}>
                        {planMeta(p).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Business email</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Optional — defaults to admin email"
              />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Admin name *</Label>
              <Input
                value={createForm.adminName}
                onChange={(e) => setCreateForm((f) => ({ ...f, adminName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin email *</Label>
              <Input
                type="email"
                value={createForm.adminEmail}
                onChange={(e) => setCreateForm((f) => ({ ...f, adminEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin password *</Label>
              <Input
                type="password"
                value={createForm.adminPassword}
                onChange={(e) => setCreateForm((f) => ({ ...f, adminPassword: e.target.value }))}
                placeholder="Min. 6 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={createTenant} disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tenant */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the tenant and all associated data (leads, chats, documents, etc.).
              Tenants with super admin users cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password reset (detail dialog) */}
      <Dialog open={!!resetUserId} onOpenChange={(o) => !o && setResetUserId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for this user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New password</Label>
            <Input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Min. 6 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUserId(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={resetUserPassword} disabled={resetting || resetPassword.length < 6}>
              {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  hint,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
  accent:
    | "blue"
    | "emerald"
    | "accent"
    | "amber"
    | "violet"
    | "cyan"
    | "rose"
    | "orange";
}) {
  const ringMap: Record<string, string> = {
    blue: "text-primary bg-primary/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    accent: "text-[#4d7c0f] bg-accent/30",
    amber: "text-amber-600 bg-amber-500/10",
    violet: "text-violet-600 bg-violet-500/10",
    cyan: "text-cyan-600 bg-cyan-500/10",
    rose: "text-rose-600 bg-rose-500/10",
    orange: "text-orange-600 bg-orange-500/10",
  };
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
            ringMap[accent]
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </div>
          <div className="text-2xl font-bold tracking-tight mt-0.5 truncate">
            {value}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Plans breakdown card ────────────────────────────────────────

function PlansBreakdownCard({
  loading,
  breakdown,
  total,
}: {
  loading: boolean;
  breakdown: { plan: string; count: number }[];
  total: number;
}) {
  // Build full list including zeros
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const b of breakdown) map.set(b.plan, b.count);
    return PLAN_ORDER.map((p) => ({ plan: p, count: map.get(p) ?? 0 }));
  }, [breakdown]);

  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-500" />
          Plans Breakdown
        </CardTitle>
        <CardDescription>
          Distribution of businesses across subscription plans.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No businesses yet.
          </p>
        ) : (
          counts.map(({ plan, count }) => {
            const meta = planMeta(plan);
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const widthPct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
            return (
              <div key={plan} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="font-medium">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatNumber(count)}
                    </span>
                    <span className="tabular-nums">({pct}%)</span>
                  </div>
                </div>
                <div className="relative">
                  <Progress value={widthPct} className={cn("h-2.5", meta.barClass)} />
                </div>
              </div>
            );
          })
        )}
        {!loading && total > 0 && (
          <div className="pt-2 border-t text-xs text-muted-foreground flex items-center justify-between">
            <span>Total businesses</span>
            <span className="font-semibold text-foreground">{formatNumber(total)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recent businesses card ──────────────────────────────────────

function RecentBusinessesCard({
  loading,
  businesses,
  onView,
}: {
  loading: boolean;
  businesses: StatsData["recentBusinesses"];
  onView: (id: string) => void;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Recent Businesses
        </CardTitle>
        <CardDescription>
          The 5 most recently created businesses on the platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : businesses.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No businesses yet.
          </p>
        ) : (
          businesses.map((b) => {
            const meta = planMeta(b.plan);
            return (
              <div
                key={b.id}
                className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors group"
              >
                <Avatar className="h-9 w-9 border">
                  <AvatarFallback className="bg-muted text-xs">
                    {b.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{b.name}</div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {b.email || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={cn("text-[10px]", meta.badgeClass)}>
                    {meta.label}
                  </Badge>
                  <StatusBadge status={b.status} />
                  <span className="text-xs text-muted-foreground hidden sm:inline tabular-nums">
                    {timeAgo(b.createdAt)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onView(b.id)}
                    title="View details"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ─── Business table row ──────────────────────────────────────────

function BusinessRowItem({
  business,
  onView,
  onToggle,
  onPlanChange,
  onDelete,
}: {
  business: BusinessRow;
  onView: () => void;
  onToggle: () => void;
  onPlanChange: (plan: Plan) => void;
  onDelete: () => void;
}) {
  const meta = planMeta(business.plan);
  const isActive = business.status === "active";
  return (
    <TableRow className="group">
      <TableCell className="pl-6">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border">
            <AvatarFallback
              className={cn(
                "text-xs",
                isActive ? "bg-muted" : "bg-destructive/10 text-destructive"
              )}
            >
              {business.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{business.name}</div>
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {business.email || "—"}
              {business.industry && (
                <span className="hidden md:inline opacity-70">· {business.industry}</span>
              )}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge className={meta.badgeClass}>{meta.label}</Badge>
      </TableCell>
      <TableCell>
        <StatusBadge status={business.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 flex-wrap">
          <MiniStat icon={<Users className="h-3 w-3" />} value={business.stats.users} title="Users" />
          <MiniStat icon={<TrendingUp className="h-3 w-3" />} value={business.stats.leads} title="Leads" />
          <MiniStat icon={<MessageSquare className="h-3 w-3" />} value={business.stats.chats} title="Chats" />
          <MiniStat icon={<Ticket className="h-3 w-3" />} value={business.stats.tickets} title="Tickets" />
        </div>
      </TableCell>
      <TableCell>
        <div className="text-xs space-y-0.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Cpu className="h-3 w-3" />
            <span className="tabular-nums">{formatCompact(business.aiUsage.tokens)} tok</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <CircleDollarSign className="h-3 w-3" />
            <span className="tabular-nums">${formatCost(business.aiUsage.costUsd)}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground tabular-nums" title={formatDate(business.createdAt)}>
          {timeAgo(business.createdAt)}
        </span>
      </TableCell>
      <TableCell className="pr-6 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 opacity-60 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onView}>
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onToggle}
              className={isActive ? "text-destructive focus:text-destructive" : ""}
            >
              {isActive ? (
                <>
                  <Ban className="h-4 w-4 mr-2" />
                  Suspend
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Activate
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightCircle className="h-4 w-4 mr-2" />
                Change Plan
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {PLAN_ORDER.map((p) => {
                  const m = planMeta(p);
                  return (
                    <DropdownMenuItem
                      key={p}
                      onClick={() => onPlanChange(p as Plan)}
                      disabled={business.plan === p}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        {m.label}
                      </span>
                      {business.plan === p && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Tenant
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function MiniStat({
  icon,
  value,
  title,
}: {
  icon: React.ReactNode;
  value: number;
  title: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums"
    >
      <span className="text-muted-foreground">{icon}</span>
      {formatNumber(value)}
    </span>
  );
}

// ─── Status badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/15 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </Badge>
    );
  }
  if (status === "suspended") {
    return (
      <Badge variant="destructive" className="gap-1">
        <Ban className="h-3 w-3" />
        Suspended
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="capitalize">
      {status}
    </Badge>
  );
}

// ─── Count tile ──────────────────────────────────────────────────

function CountTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{formatNumber(value)}</div>
    </div>
  );
}
