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
} from "lucide-react";

export type PlatformTabId =
  | "overview"
  | "tenants"
  | "health"
  | "usage"
  | "users"
  | "audit"
  | "platform"
  | "subscriptions"
  | "payments"
  | "invoices";

export type PlatformNavGroup = "main" | "billing" | "system";

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
  { id: "subscriptions", label: "Subscriptions", icon: Crown, group: "billing", desc: "Plans & trials" },
  { id: "payments", label: "Payments", icon: CreditCard, group: "billing", desc: "Transactions" },
  { id: "invoices", label: "Invoices", icon: Receipt, group: "billing", desc: "Billing records" },
  { id: "platform", label: "Platform", icon: Settings2, group: "system", desc: "Setup, plans, email, retention" },
  { id: "audit", label: "Audit Logs", icon: History, group: "system", desc: "Activity timeline" },
];

export const PLATFORM_NAV_GROUPS: { key: PlatformNavGroup; label: string }[] = [
  { key: "main", label: "Operations" },
  { key: "billing", label: "Billing" },
  { key: "system", label: "System" },
];

export function platformTabLabel(id: PlatformTabId): string {
  return PLATFORM_NAV.find((n) => n.id === id)?.label ?? id;
}
