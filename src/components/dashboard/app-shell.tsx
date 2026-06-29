"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Bot,
  BookOpen,
  MessagesSquare,
  Users,
  FileText,
  BarChart3,
  LogOut,
  Menu,
  X,
  Code2,
  Settings,
  ChevronRight,
  Search,
  Ticket,
  History,
  MessageCircle,
  Zap,
  Plug,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DanetsLogo } from "@/components/dashboard/shared/danets-logo";
import { ThemeToggle } from "@/components/dashboard/shared/theme-toggle";
import { NotificationBell } from "@/components/dashboard/shared/notification-bell";
import { CommandPalette } from "@/components/dashboard/shared/command-palette";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type ViewId =
  | "overview"
  | "agent"
  | "knowledge"
  | "conversations"
  | "leads"
  | "quotes"
  | "tickets"
  | "documents"
  | "whatsapp"
  | "automations"
  | "analytics"
  | "usage"
  | "embed"
  | "integrations"
  | "subscription"
  | "settings"
  | "audit";

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: "main" | "tools" | "system";
  desc?: string;
}

const NAV: NavItem[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, group: "main", desc: "Overview & stats" },
  { id: "conversations", label: "Conversations", icon: MessagesSquare, group: "main", desc: "Chat sessions" },
  { id: "leads", label: "Leads", icon: Users, group: "main", desc: "Captured leads" },
  { id: "tickets", label: "Support Tickets", icon: Ticket, group: "main", desc: "Customer support" },
  { id: "quotes", label: "Quotes & Proposals", icon: FileText, group: "tools", desc: "AI proposal generator" },
  { id: "documents", label: "Document Assistant", icon: FileText, group: "tools", desc: "AI document Q&A" },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, group: "tools", desc: "Templates & automation" },
  { id: "automations", label: "Automations", icon: Zap, group: "tools", desc: "Workflow builder" },
  { id: "analytics", label: "Analytics", icon: BarChart3, group: "tools", desc: "Reports & insights" },
  { id: "usage", label: "AI Usage", icon: BarChart3, group: "tools", desc: "Token & cost logs" },
  { id: "agent", label: "AI Agent", icon: Bot, group: "tools", desc: "Bot configuration" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, group: "tools", desc: "KB articles" },
  { id: "embed", label: "Widget Embed", icon: Code2, group: "system", desc: "Install instructions" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "system", desc: "Provider settings" },
  { id: "subscription", label: "Subscription", icon: CreditCard, group: "system", desc: "Plan & billing" },
  { id: "audit", label: "Audit Logs", icon: History, group: "system", desc: "Activity tracking" },
  { id: "settings", label: "Settings", icon: Settings, group: "system", desc: "Business settings" },
];

export function AppShell({
  user,
  active,
  onNavigate,
  onLogout,
  children,
}: {
  user: {
    name: string;
    email: string;
    businessName: string;
    businessId: string;
  };
  active: ViewId;
  onNavigate: (v: ViewId) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Cmd+K / Ctrl+K to open command palette
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const groups: { key: NavItem["group"]; label: string }[] = [
    { key: "main", label: "Workspace" },
    { key: "tools", label: "AI Tools" },
    { key: "system", label: "System" },
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Signed out");
    onLogout();
  }

  const activeItem = NAV.find((n) => n.id === active);

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
        <SidebarContent
          active={active}
          onNavigate={(v) => {
            onNavigate(v);
            setMobileOpen(false);
          }}
          groups={groups}
        />
        <SidebarFooter user={user} onLogout={logout} />
      </aside>

      {/* Sidebar - mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[80%] bg-sidebar text-sidebar-foreground flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
              <DanetsLogo size="sm" />
              <Button
                size="icon"
                variant="ghost"
                className="text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => setMobileOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <SidebarContent
              active={active}
              onNavigate={(v) => {
                onNavigate(v);
                setMobileOpen(false);
              }}
              groups={groups}
            />
            <SidebarFooter user={user} onLogout={logout} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 backdrop-blur px-4 lg:px-6">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </Button>
          <div className="lg:hidden">
            <DanetsLogo size="sm" variant="icon" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Danets AI</span>
            <ChevronRight size={14} />
            <span className="font-medium text-foreground">
              {activeItem?.label}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden md:flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors w-48"
              aria-label="Open command palette"
            >
              <Search size={14} />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="text-[10px] font-medium bg-background border rounded px-1.5 py-0.5">
                ⌘K
              </kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden"
              onClick={() => setCmdOpen(true)}
              aria-label="Search"
            >
              <Search size={18} />
            </Button>
            <div className="hidden md:flex items-center gap-2 rounded-full bg-accent/20 px-3 py-1 text-xs font-medium text-accent-foreground">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Agent online
            </div>
            <ThemeToggle />
            <NotificationBell businessId={user.businessId} onNavigate={onNavigate} />
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium leading-tight">{user.name}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                {user.businessName}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {children}
        </main>

        {/* Footer */}
        <footer className="mt-auto border-t bg-background px-4 lg:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <DanetsLogo size="sm" variant="icon" />
            <span>© {new Date().getFullYear()} Danets TecPro Limited</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Software · Cloud · AI · Cybersecurity</span>
          </div>
        </footer>
      </div>

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function SidebarContent({
  active,
  onNavigate,
  groups,
}: {
  active: ViewId;
  onNavigate: (v: ViewId) => void;
  groups: { key: NavItem["group"]; label: string }[];
}) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto scroll-thin">
      <div className="p-4 border-b border-sidebar-border">
        <DanetsLogo size="md" />
      </div>
      <nav className="flex-1 p-3 space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="space-y-1">
            <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {g.label}
            </div>
            {NAV.filter((n) => n.group === g.key).map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all group relative",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-sidebar-primary-foreground/80" />
                  )}
                  <Icon
                    size={18}
                    className={cn(
                      "shrink-0 transition-transform",
                      !isActive && "group-hover:scale-110"
                    )}
                  />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isActive && <ChevronRight size={14} className="opacity-70" />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
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
    <div className="p-3 border-t border-sidebar-border">
      <div className="flex items-center gap-3 rounded-lg p-2">
        <div className="h-9 w-9 rounded-full brand-gradient flex items-center justify-center text-white text-sm font-bold shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-sidebar-foreground truncate">
            {user.name}
          </div>
          <div className="text-xs text-sidebar-foreground/60 truncate">
            {user.email}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="text-sidebar-foreground/70 hover:bg-sidebar-accent shrink-0"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut size={16} />
        </Button>
      </div>
    </div>
  );
}
