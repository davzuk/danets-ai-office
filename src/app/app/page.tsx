"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell, type ViewId } from "@/components/dashboard/app-shell";
import {
  ModuleLockedView,
  getViewLockInfo,
} from "@/components/dashboard/shared/module-locked-view";

// Lazy-load every view. The dashboard is the largest single client chunk in
// the app, and most users only ever visit 2-3 tabs in a session. Each
// dynamic import keeps the initial payload under ~150kB and lets Vite/Rspack
// code-split the bundles per route.
const OverviewView = dynamic(
  () => import("@/components/dashboard/views/overview-view").then((m) => m.OverviewView),
  { ssr: false }
);
const AgentView = dynamic(
  () => import("@/components/dashboard/views/agent-view").then((m) => m.AgentView),
  { ssr: false }
);
const KnowledgeView = dynamic(
  () => import("@/components/dashboard/views/knowledge-view").then((m) => m.KnowledgeView),
  { ssr: false }
);
const ConversationsView = dynamic(
  () => import("@/components/dashboard/views/conversations-view").then((m) => m.ConversationsView),
  { ssr: false }
);
const LeadsView = dynamic(
  () => import("@/components/dashboard/views/leads-view").then((m) => m.LeadsView),
  { ssr: false }
);
const QuotesView = dynamic(
  () => import("@/components/dashboard/views/quotes-view").then((m) => m.QuotesView),
  { ssr: false }
);
const TicketsView = dynamic(
  () => import("@/components/dashboard/views/tickets-view").then((m) => m.TicketsView),
  { ssr: false }
);
const DocumentsView = dynamic(
  () => import("@/components/dashboard/views/documents-view").then((m) => m.DocumentsView),
  { ssr: false }
);
const WhatsAppView = dynamic(
  () => import("@/components/dashboard/views/whatsapp-view").then((m) => m.WhatsAppView),
  { ssr: false }
);
const UsageView = dynamic(
  () => import("@/components/dashboard/views/usage-view").then((m) => m.UsageView),
  { ssr: false }
);
const EmbedView = dynamic(
  () => import("@/components/dashboard/views/embed-view").then((m) => m.EmbedView),
  { ssr: false }
);
const SettingsView = dynamic(
  () => import("@/components/dashboard/views/settings-view").then((m) => m.SettingsView),
  { ssr: false }
);
const AuditLogsView = dynamic(
  () => import("@/components/dashboard/views/audit-logs-view").then((m) => m.AuditLogsView),
  { ssr: false }
);
const AutomationsView = dynamic(
  () => import("@/components/dashboard/views/automations-view").then((m) => m.AutomationsView),
  { ssr: false }
);
const IntegrationsView = dynamic(
  () => import("@/components/dashboard/views/integrations-view").then((m) => m.IntegrationsView),
  { ssr: false }
);
const SubscriptionView = dynamic(
  () => import("@/components/dashboard/views/subscription-view").then((m) => m.SubscriptionView),
  { ssr: false }
);
const AnalyticsView = dynamic(
  () => import("@/components/dashboard/views/analytics-view").then((m) => m.AnalyticsView),
  { ssr: false }
);

interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
  isSuperAdmin?: boolean;
  isImpersonating?: boolean;
}

interface SubscriptionInfo {
  status: string;
  level: "full" | "read_only" | "blocked";
  message?: string;
}

interface ModuleAccessInfo {
  plan: string;
  modules: Record<string, { enabled: boolean; label: string; requiredPlanLabel: string }>;
  enabledModules: string[];
}

export default function AppHome() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [moduleAccess, setModuleAccess] = useState<ModuleAccessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewId>("overview");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          // Unauthenticated visitors land on the public marketing site,
          // and go through /login to enter the dashboard.
          window.location.href = "/login";
          return;
        }
        if (data.user?.isImpersonating) {
          setUser(data.user);
          setSubscription(null);
          setModuleAccess(null);
          return;
        }
        if (data.user?.isSuperAdmin) {
          window.location.href = "/platform";
          return;
        }
        if (data.user) {
          setUser(data.user);
          setSubscription(data.subscription ?? null);
          setModuleAccess(data.modules ?? null);
          // Deep link back from the OAuth connect flow (/api/connections/*/callback).
          if (new URLSearchParams(window.location.search).get("view") === "integrations") {
            setView("integrations");
          }
        }
      })
      .catch(() => {
        window.location.href = "/login";
      })
      .finally(() => setLoading(false));
  }, []);

  // `!user` covers the window between a redirect being issued (to /login or
  // /platform) and the navigation actually happening, plus a failed /me call.
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const lockInfo = getViewLockInfo(view, moduleAccess);

  const renderView = () => {
    if (lockInfo) {
      return (
        <ModuleLockedView
          moduleLabel={lockInfo.moduleLabel}
          requiredPlanLabel={lockInfo.requiredPlanLabel}
          currentPlan={lockInfo.currentPlan}
          onUpgrade={() => setView("subscription")}
        />
      );
    }

    switch (view) {
      case "overview": return <OverviewView user={user} onNavigate={(v) => setView(v as ViewId)} />;
      case "agent": return <AgentView user={user} />;
      case "knowledge": return <KnowledgeView user={user} />;
      case "conversations": return <ConversationsView user={user} />;
      case "leads": return <LeadsView user={user} />;
      case "quotes": return <QuotesView user={user} />;
      case "tickets": return <TicketsView user={user} />;
      case "documents": return <DocumentsView user={user} />;
      case "whatsapp": return <WhatsAppView user={user} />;
      case "automations": return <AutomationsView user={user} />;
      case "analytics": return <AnalyticsView user={user} onNavigate={(v) => setView(v as ViewId)} />;
      case "usage": return <UsageView user={user} />;
      case "embed": return <EmbedView user={user} />;
      case "integrations": return <IntegrationsView user={user} />;
      case "subscription": return <SubscriptionView user={user} />;
      case "settings": return <SettingsView user={user} onNavigate={(v) => setView(v as ViewId)} />;
      case "audit": return <AuditLogsView user={user} />;
      default: return null;
    }
  };

  return (
    <ErrorBoundary>
      <AppShell
        user={user}
        active={view}
        onNavigate={setView}
        onLogout={() => {
          setUser(null);
          setSubscription(null);
          setModuleAccess(null);
          setView("overview");
          window.location.href = "/login";
        }}
        onSessionChange={setUser}
        subscription={subscription}
        moduleAccess={moduleAccess}
      >
        {/* key={view} forces a remount so the CSS fade re-runs on navigation */}
        <div key={view} className="animate-view-fade">
          {renderView()}
        </div>
      </AppShell>
    </ErrorBoundary>
  );
}