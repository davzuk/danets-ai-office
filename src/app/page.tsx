"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { AppShell, type ViewId } from "@/components/dashboard/app-shell";
import { OverviewView } from "@/components/dashboard/views/overview-view";
import { AgentView } from "@/components/dashboard/views/agent-view";
import { KnowledgeView } from "@/components/dashboard/views/knowledge-view";
import { ConversationsView } from "@/components/dashboard/views/conversations-view";
import { LeadsView } from "@/components/dashboard/views/leads-view";
import { QuotesView } from "@/components/dashboard/views/quotes-view";
import { UsageView } from "@/components/dashboard/views/usage-view";
import { EmbedView } from "@/components/dashboard/views/embed-view";
import { SettingsView } from "@/components/dashboard/views/settings-view";

interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthed={(u) => setUser(u)} />;
  }

  return (
    <AppShell
      user={user}
      active={view}
      onNavigate={setView}
      onLogout={() => {
        setUser(null);
        setView("overview");
      }}
    >
      {view === "overview" && <OverviewView user={user} onNavigate={setView} />}
      {view === "agent" && <AgentView user={user} />}
      {view === "knowledge" && <KnowledgeView user={user} />}
      {view === "conversations" && <ConversationsView user={user} />}
      {view === "leads" && <LeadsView user={user} />}
      {view === "quotes" && <QuotesView user={user} />}
      {view === "usage" && <UsageView user={user} />}
      {view === "embed" && <EmbedView user={user} />}
      {view === "settings" && <SettingsView user={user} />}
    </AppShell>
  );
}
