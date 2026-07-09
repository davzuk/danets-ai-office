"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { PlatformAuthScreen } from "@/components/auth/platform-auth-screen";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SuperAdminView } from "@/components/dashboard/views/super-admin-view";
import type { PlatformTabId } from "@/lib/platform-nav";

interface PlatformUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
  isSuperAdmin: boolean;
  isPlatformAdmin?: boolean;
  totpEnabled?: boolean;
}

export default function PlatformPage() {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PlatformTabId>("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/platform-auth/me").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ])
      .then(([platform, tenant]) => {
        if (tenant.user?.isImpersonating) {
          window.location.href = "/";
          return;
        }
        if (platform.admin) {
          setUser(platform.admin);
          return;
        }
        if (tenant.user?.isSuperAdmin) {
          setUser(tenant.user);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <PlatformAuthScreen onAuthed={setUser} />;
  }

  return (
    <ErrorBoundary>
      <PlatformShell
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={handleRefresh}
        refreshing={false}
        onLogout={() => setUser(null)}
      >
        <SuperAdminView
          key={refreshKey}
          user={user}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onSessionChange={() => {
            window.location.href = "/";
          }}
        />
      </PlatformShell>
    </ErrorBoundary>
  );
}
