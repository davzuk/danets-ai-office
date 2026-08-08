"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LogOut,
  Shield,
  Menu,
  X,
  ChevronRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DanetsLogo } from "@/components/dashboard/shared/danets-logo";
import { ThemeToggle } from "@/components/dashboard/shared/theme-toggle";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PLATFORM_NAV,
  PLATFORM_NAV_GROUPS,
  platformTabLabel,
  type PlatformTabId,
} from "@/lib/platform-nav";

interface PlatformShellUser {
  userId: string;
  name: string;
  email: string;
  businessName: string;
  isPlatformAdmin?: boolean;
}

export function PlatformShell({
  user,
  activeTab,
  onTabChange,
  onRefresh,
  refreshing,
  onLogout,
  children,
}: {
  user: PlatformShellUser;
  activeTab: PlatformTabId;
  onTabChange: (tab: PlatformTabId) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await Promise.all([
      fetch("/api/platform-auth/logout", { method: "POST" }),
      fetch("/api/auth/logout", { method: "POST" }),
    ]);
    toast.success("Signed out of platform console");
    onLogout();
  }

  const sidebar = (
    <SidebarNav
      active={activeTab}
      onNavigate={(tab) => {
        onTabChange(tab);
        setMobileOpen(false);
      }}
    />
  );

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="hidden lg:flex w-64 flex-col bg-slate-950 text-slate-100 border-r border-slate-800 shrink-0">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-5 w-5 text-amber-400" />
            <span className="font-semibold text-sm">Platform Console</span>
          </div>
          <p className="text-[11px] text-slate-400">Danets TecPro internal</p>
        </div>
        {sidebar}
        <SidebarFooter user={user} onLogout={logout} />
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 max-w-[85%] bg-slate-950 text-slate-100 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <span className="font-semibold text-sm">Platform Console</span>
              <Button size="icon" variant="ghost" className="text-slate-300" onClick={() => setMobileOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            {sidebar}
            <SidebarFooter user={user} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 backdrop-blur px-4 lg:px-6">
          <Button size="icon" variant="ghost" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </Button>
          <div className="lg:hidden">
            <DanetsLogo size="sm" variant="icon" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Platform</span>
            <ChevronRight size={14} />
            <span className="font-medium text-foreground">{platformTabLabel(activeTab)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onRefresh && (
              <Button size="sm" variant="outline" onClick={onRefresh} className="h-8 gap-1.5 hidden sm:flex">
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                Refresh
              </Button>
            )}
            <Link href="/app" className="hidden sm:flex">
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
                Tenant app
              </Button>
            </Link>
            <ThemeToggle />
            <div className="text-right hidden md:block">
              <div className="text-xs font-medium leading-tight">{user.name}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                {user.isPlatformAdmin ? "Platform Admin" : "Super Admin"}
              </div>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 p-4 lg:p-6 overflow-x-hidden">{children}</main>

        <footer className="border-t bg-background px-4 py-2 text-[11px] text-muted-foreground text-center">
          All platform actions are audit-logged
        </footer>
      </div>
    </div>
  );
}

function SidebarNav({
  active,
  onNavigate,
}: {
  active: PlatformTabId;
  onNavigate: (tab: PlatformTabId) => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto scroll-thin p-3 space-y-5">
      {PLATFORM_NAV_GROUPS.map((g) => (
        <div key={g.key} className="space-y-1">
          <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {g.label}
          </div>
          {PLATFORM_NAV.filter((n) => n.group === g.key).map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                  isActive
                    ? "bg-amber-500/20 text-amber-100 border border-amber-500/30"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                )}
              >
                <Icon size={18} className="shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && <ChevronRight size={14} className="opacity-70" />}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({
  user,
  onLogout,
}: {
  user: { name: string; email: string };
  onLogout: () => void;
}) {
  return (
    <div className="p-3 border-t border-slate-800">
      <div className="flex items-center gap-3 rounded-lg p-2">
        <div className="h-9 w-9 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-200 text-sm font-bold shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-100 truncate">{user.name}</div>
          <div className="text-xs text-slate-400 truncate">{user.email}</div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut size={16} />
        </Button>
      </div>
    </div>
  );
}
