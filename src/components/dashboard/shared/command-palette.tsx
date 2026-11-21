"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  FileText,
  BarChart3,
  Bot,
  BookOpen,
  Code2,
  Settings,
  Bell,
  Moon,
  Ticket,
  History,
  MessageCircle,
  Sun,
  Plus,
  Download,
  Sparkles,
  Search,
  Zap,
  Plug,
  CreditCard,
  Lock,
  Images,
} from "lucide-react";
import type { ViewId } from "@/components/dashboard/app-shell";
import { useTheme } from "next-themes";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (v: ViewId) => void;
  moduleAccess?: {
    modules: Record<string, { enabled: boolean; requiredPlanLabel: string }>;
  } | null;
  /**
   * When true, surfaces a platform-admin hint in the placeholder copy so
   * the user knows their cross-tenant actions (impersonation, plan
   * overrides) are in scope. The default copy says "Type a command…"
   * which is correct for tenant admins but misleading for platform staff
   * who use Cmd+K to jump into tenant views.
   */
  isPlatformAdmin?: boolean;
}

/** The platform console is a separate page, not a dashboard view. */
function openPlatform(tab: "overview" | "tenants" | "users") {
  window.location.href = tab === "overview" ? "/platform" : `/platform?tab=${tab}`;
}

const NAV_ITEMS: {
  id: ViewId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  hint: string;
}[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, hint: "Overview & stats" },
  { id: "conversations", label: "Conversations", icon: MessagesSquare, hint: "Chat sessions" },
  { id: "leads", label: "Leads", icon: Users, hint: "Captured leads" },
  { id: "tickets", label: "Support Tickets", icon: Ticket, hint: "Customer support" },
  { id: "quotes", label: "Quotes & Proposals", icon: FileText, hint: "AI proposal generator" },
  { id: "documents", label: "Document Assistant", icon: FileText, hint: "AI document Q&A" },
  { id: "social", label: "Content Studio", icon: Sparkles, hint: "AI social posts" },
  { id: "media", label: "Media Library", icon: Images, hint: "Images & videos" },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, hint: "Templates & automation" },
  { id: "automations", label: "Automations", icon: Zap, hint: "Workflow builder" },
  { id: "analytics", label: "Analytics", icon: BarChart3, hint: "Reports & insights" },
  { id: "usage", label: "AI Usage", icon: BarChart3, hint: "Token & cost logs" },
  { id: "agent", label: "AI Agent", icon: Bot, hint: "Bot configuration" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, hint: "KB articles" },
  { id: "embed", label: "Widget Embed", icon: Code2, hint: "Install instructions" },
  { id: "integrations", label: "Integrations", icon: Plug, hint: "Provider settings" },
  { id: "subscription", label: "Subscription", icon: CreditCard, hint: "Plan & billing" },
  { id: "audit", label: "Audit Logs", icon: History, hint: "Activity tracking" },
  { id: "settings", label: "Settings", icon: Settings, hint: "Business settings" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  moduleAccess,
  isPlatformAdmin = false,
}: CommandPaletteProps) {
  const { theme, setTheme } = useTheme();

  function run(fn: () => void) {
    onOpenChange(false);
    setTimeout(fn, 50);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={
          isPlatformAdmin
            ? "Search workspaces, jump to tenant, or run an admin action…"
            : "Type a command or search…"
        }
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {isPlatformAdmin ? (
          <CommandGroup heading="Platform">
            <CommandItem
              value="open platform control plane admin dashboard"
              onSelect={() => run(() => openPlatform("overview"))}
              className="gap-2"
            >
              <Lock size={16} className="text-primary" />
              <span>Open Platform Control Plane</span>
              <span className="ml-auto text-xs text-muted-foreground">
                /platform
              </span>
            </CommandItem>
            <CommandItem
              value="search tenants businesses accounts"
              onSelect={() => run(() => openPlatform("tenants"))}
              className="gap-2"
            >
              <Search size={16} className="text-muted-foreground" />
              <span>Search Tenants</span>
            </CommandItem>
            <CommandItem
              value="search platform users admin staff"
              onSelect={() => run(() => openPlatform("users"))}
              className="gap-2"
            >
              <Users size={16} className="text-muted-foreground" />
              <span>Search Platform Users</span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => {
            const locked = moduleAccess?.modules[item.id]?.enabled === false;
            return (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.hint} navigate go to`}
                onSelect={() => run(() => onNavigate(item.id))}
                className="gap-2"
                disabled={locked}
              >
                <item.icon size={16} className="text-muted-foreground" />
                <span>{item.label}</span>
                {locked ? (
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock size={10} />
                    {moduleAccess?.modules[item.id]?.requiredPlanLabel}+
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="new proposal quote generate"
            onSelect={() => run(() => onNavigate("quotes"))}
            className="gap-2"
          >
            <Plus size={16} className="text-primary" />
            <span>New Proposal</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">Quotes</kbd>
          </CommandItem>
          <CommandItem
            value="new knowledge article add kb"
            onSelect={() => run(() => onNavigate("knowledge"))}
            className="gap-2"
          >
            <Plus size={16} className="text-primary" />
            <span>New Knowledge Article</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">KB</kbd>
          </CommandItem>
          <CommandItem
            value="export leads csv download"
            onSelect={() => run(() => onNavigate("leads"))}
            className="gap-2"
          >
            <Download size={16} className="text-accent-foreground" />
            <span>Export Leads (CSV)</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">Leads</kbd>
          </CommandItem>
          <CommandItem
            value="test chatbot widget preview"
            onSelect={() => run(() => onNavigate("embed"))}
            className="gap-2"
          >
            <Sparkles size={16} className="text-accent-foreground" />
            <span>Test Chatbot Widget</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">Embed</kbd>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Theme">
          <CommandItem
            value="toggle dark mode theme light"
            onSelect={() =>
              run(() => setTheme(theme === "dark" ? "light" : "dark"))
            }
            className="gap-2"
          >
            {theme === "dark" ? (
              <Sun size={16} className="text-accent-foreground" />
            ) : (
              <Moon size={16} className="text-primary" />
            )}
            <span>Toggle {theme === "dark" ? "Light" : "Dark"} Mode</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          <CommandItem
            value="search help how to use"
            onSelect={() => run(() => onNavigate("embed"))}
            className="gap-2"
          >
            <Search size={16} className="text-muted-foreground" />
            <span>How to embed the widget</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
