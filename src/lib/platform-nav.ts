import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Building2,
  Gauge,
  HeartPulse,
  Users,
  History,
  Settings2,
  Crown,
  CreditCard,
  Receipt,
  Newspaper,
  FileText,
  Link as LinkIcon,
  Boxes,
  ImageIcon,
  Globe,
} from "lucide-react";

export type PlatformTabId =
  | "overview"
  | "tenants"
  | "health"
  | "usage"
  | "users"
  | "sites"
  | "audit"
  | "platform"
  | "subscriptions"
  | "payments"
  | "invoices"
  | "cms-pages"
  | "cms-posts"
  | "cms-nav"
  | "cms-blocks"
  | "cms-media"
  | "cms-contacts"
  | "cms-site";

export type PlatformNavGroup = "main" | "billing" | "system" | "cms";

export interface PlatformNavItem {
  id: PlatformTabId;
  label: string;
  icon: LucideIcon;
  group: PlatformNavGroup;
  desc?: string;
}

export const PLATFORM_NAV: PlatformNavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "main", desc: "KPIs & revenue" },
  { id: "tenants", label: "Tenants", icon: Building2, group: "main", desc: "Manage businesses" },
  { id: "health", label: "Tenant Health", icon: HeartPulse, group: "main", desc: "Risk & alerts" },
  { id: "usage", label: "Usage", icon: Gauge, group: "main", desc: "Quota consumption" },
  { id: "users", label: "Users", icon: Users, group: "main", desc: "Cross-tenant users" },
  { id: "sites", label: "Tenant sites", icon: Globe, group: "main", desc: "Tenant websites" },
  { id: "subscriptions", label: "Subscriptions", icon: Crown, group: "billing", desc: "Plans & trials" },
  { id: "payments", label: "Payments", icon: CreditCard, group: "billing", desc: "Transactions" },
  { id: "invoices", label: "Invoices", icon: Receipt, group: "billing", desc: "Billing records" },
  { id: "cms-pages", label: "Pages", icon: FileText, group: "cms", desc: "Marketing site pages" },
  { id: "cms-posts", label: "Blog posts", icon: Newspaper, group: "cms", desc: "News & articles" },
  { id: "cms-nav", label: "Navigation", icon: LinkIcon, group: "cms", desc: "Top nav & footer" },
  { id: "cms-blocks", label: "Blocks", icon: Boxes, group: "cms", desc: "Block library" },
  { id: "cms-media", label: "Media", icon: ImageIcon, group: "cms", desc: "Images & uploads" },
  { id: "cms-contacts", label: "Contact inbox", icon: Receipt, group: "cms", desc: "Website form submissions" },
  { id: "cms-site", label: "Site settings", icon: Settings2, group: "cms", desc: "Brand, contact & SEO defaults" },
  { id: "platform", label: "Platform", icon: Settings2, group: "system", desc: "Setup, plans, email, retention" },
  { id: "audit", label: "Audit Logs", icon: History, group: "system", desc: "Activity timeline" },
];

export const PLATFORM_NAV_GROUPS: { key: PlatformNavGroup; label: string }[] = [
  { key: "main", label: "Operations" },
  { key: "billing", label: "Billing" },
  { key: "cms", label: "Website CMS" },
  { key: "system", label: "System" },
];

export function platformTabLabel(id: PlatformTabId): string {
  return PLATFORM_NAV.find((n) => n.id === id)?.label ?? id;
}
