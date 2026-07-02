"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthScreen } from "@/components/auth/auth-screen";
import { AppShell, type ViewId } from "@/components/dashboard/app-shell";
import { OverviewView } from "@/components/dashboard/views/overview-view";
import { AgentView } from "@/components/dashboard/views/agent-view";
import { KnowledgeView } from "@/components/dashboard/views/knowledge-view";
import { ConversationsView } from "@/components/dashboard/views/conversations-view";
import { LeadsView } from "@/components/dashboard/views/leads-view";
import { QuotesView } from "@/components/dashboard/views/quotes-view";
import { TicketsView } from "@/components/dashboard/views/tickets-view";
import { DocumentsView } from "@/components/dashboard/views/documents-view";
import { WhatsAppView } from "@/components/dashboard/views/whatsapp-view";
import { UsageView } from "@/components/dashboard/views/usage-view";
import { EmbedView } from "@/components/dashboard/views/embed-view";
import { SettingsView } from "@/components/dashboard/views/settings-view";
import { AuditLogsView } from "@/components/dashboard/views/audit-logs-view";
import { AutomationsView } from "@/components/dashboard/views/automations-view";
import { IntegrationsView } from "@/components/dashboard/views/integrations-view";
import { SubscriptionView } from "@/components/dashboard/views/subscription-view";
import { AnalyticsView } from "@/components/dashboard/views/analytics-view";
import { SuperAdminView } from "@/components/dashboard/views/super-admin-view";

interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
  isSuperAdmin: boolean;
}

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewId>("overview");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <AuthScreen onAuthed={(u) => setUser(u)} />
      </motion.div>
    );
  }

  const renderView = () => {
    switch (view) {
      case "overview": return <OverviewView user={user} onNavigate={setView} />;
      case "agent": return <AgentView user={user} />;
      case "knowledge": return <KnowledgeView user={user} />;
      case "conversations": return <ConversationsView user={user} />;
      case "leads": return <LeadsView user={user} />;
      case "quotes": return <QuotesView user={user} />;
      case "tickets": return <TicketsView user={user} />;
      case "documents": return <DocumentsView user={user} />;
      case "whatsapp": return <WhatsAppView user={user} />;
      case "automations": return <AutomationsView user={user} />;
      case "analytics": return <AnalyticsView user={user} onNavigate={setView} />;
      case "usage": return <UsageView user={user} />;
      case "embed": return <EmbedView user={user} />;
      case "integrations": return <IntegrationsView user={user} />;
      case "subscription": return <SubscriptionView user={user} />;
      case "settings": return <SettingsView user={user} />;
      case "audit": return <AuditLogsView user={user} />;
      case "super-admin": return <SuperAdminView user={user} />;
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
          setView("overview");
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </AppShell>
    </ErrorBoundary>
  );
}
