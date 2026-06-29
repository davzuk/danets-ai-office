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
  Sun,
  Plus,
  Download,
  Sparkles,
  Search,
} from "lucide-react";
import type { ViewId } from "@/components/dashboard/app-shell";
import { useTheme } from "next-themes";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (v: ViewId) => void;
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
  { id: "usage", label: "AI Usage", icon: BarChart3, hint: "Token & cost logs" },
  { id: "agent", label: "AI Agent", icon: Bot, hint: "Bot configuration" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, hint: "KB articles" },
  { id: "embed", label: "Widget Embed", icon: Code2, hint: "Install instructions" },
  { id: "audit", label: "Audit Logs", icon: History, hint: "Activity tracking" },
  { id: "settings", label: "Settings", icon: Settings, hint: "Business settings" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: CommandPaletteProps) {
  const { theme, setTheme } = useTheme();

  function run(fn: () => void) {
    onOpenChange(false);
    setTimeout(fn, 50);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.hint} navigate go to`}
              onSelect={() => run(() => onNavigate(item.id))}
              className="gap-2"
            >
              <item.icon size={16} className="text-muted-foreground" />
              <span>{item.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {item.hint}
              </span>
            </CommandItem>
          ))}
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
