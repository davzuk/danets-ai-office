"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CreditCard,
  FileText,
  Crown,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  RotateCcw,
  Calendar,
  MoreVertical,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const PLAN_BADGE: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  starter: "bg-primary text-primary-foreground",
  pro: "bg-accent text-accent-foreground",
  enterprise: "bg-violet-600 text-white",
};

const SUB_STATUS: Record<string, string> = {
  active: "text-emerald-600",
  trial: "text-blue-600",
  past_due: "text-amber-600",
  canceled: "text-muted-foreground",
  expired: "text-destructive",
};

function fmtMoney(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Subscriptions ───────────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  businessId: string;
  businessName: string;
  businessEmail: string | null;
  businessStatus: string;
  planName: string;
  status: string;
  monthlyFee: number;
  endDate: string | null;
  trialEndsAt: string | null;
  paymentMethod: string | null;
}

export function SuperAdminSubscriptionsPanel() {
  const [rows, setRows] = React.useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("all");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/super-admin/subscriptions?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load subscriptions");
      const json = await res.json();
      setRows(json.subscriptions || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [statusFilter]);

  async function patchSubscription(
    subscriptionId: string,
    body: Record<string, unknown>
  ) {
    try {
      const res = await fetch("/api/super-admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success("Subscription updated");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Crown className="h-4 w-4" /> Subscriptions
          </CardTitle>
          <CardDescription>Manage tenant subscription lifecycle, trials, and renewals.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="past_due">Past due</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No subscriptions found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">MRR</TableHead>
                <TableHead>Ends / Trial</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.businessName}</div>
                    <div className="text-xs text-muted-foreground">{r.businessEmail || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className={PLAN_BADGE[r.planName] || ""}>{r.planName}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-sm capitalize font-medium", SUB_STATUS[r.status])}>
                      {r.status.replace("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {fmtMoney(r.monthlyFee)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.trialEndsAt ? `Trial: ${fmtDate(r.trialEndsAt)}` : fmtDate(r.endDate)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => patchSubscription(r.id, { status: "active" })}
                        >
                          Set active
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patchSubscription(r.id, { status: "past_due" })}
                        >
                          Mark past due
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patchSubscription(r.id, { status: "canceled" })}
                        >
                          Cancel
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            patchSubscription(r.id, {
                              trialEndsAt: new Date(
                                Date.now() + 14 * 24 * 60 * 60 * 1000
                              ).toISOString(),
                            })
                          }
                        >
                          Start 14-day trial
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patchSubscription(r.id, { extendDays: 30 })}
                        >
                          Extend 30 days
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patchSubscription(r.id, { compMonths: 1 })}
                        >
                          Comp 1 month
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Payments ────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  businessName: string;
  amount: number;
  currency: string;
  provider: string;
  reference: string;
  status: string;
  payerEmail: string | null;
  createdAt: string;
  metadata: { planName?: string } | null;
}

export function SuperAdminPaymentsPanel() {
  const [rows, setRows] = React.useState<PaymentRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("all");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/super-admin/payments?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load payments");
      const json = await res.json();
      setRows(json.payments || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [statusFilter]);

  async function paymentAction(paymentId: string, action: "mark_paid" | "mark_failed" | "refund") {
    try {
      const res = await fetch("/api/super-admin/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      toast.success(`Payment ${action.replace("_", " ")}`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  const statusColor: Record<string, string> = {
    success: "text-emerald-600",
    pending: "text-amber-600",
    failed: "text-destructive",
    refunded: "text-muted-foreground",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Payments
          </CardTitle>
          <CardDescription>Review, confirm, and refund payments across all tenants.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.businessName}</TableCell>
                  <TableCell className="text-xs font-mono">{p.reference}</TableCell>
                  <TableCell className="text-sm capitalize">
                    {p.metadata?.planName || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {fmtMoney(p.amount, p.currency)}
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-sm capitalize", statusColor[p.status])}>
                      {p.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(p.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {p.status === "pending" && (
                          <>
                            <DropdownMenuItem onClick={() => paymentAction(p.id, "mark_paid")}>
                              <CheckCircle className="h-4 w-4 mr-2" /> Mark paid
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => paymentAction(p.id, "mark_failed")}>
                              <XCircle className="h-4 w-4 mr-2" /> Mark failed
                            </DropdownMenuItem>
                          </>
                        )}
                        {p.status === "success" && (
                          <DropdownMenuItem onClick={() => paymentAction(p.id, "refund")}>
                            <RotateCcw className="h-4 w-4 mr-2" /> Refund
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Invoices ────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  businessId: string;
  businessName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

export function SuperAdminInvoicesPanel({
  businesses,
}: {
  businesses: { id: string; name: string }[];
}) {
  const [rows, setRows] = React.useState<InvoiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({
    businessId: "",
    amount: "",
    description: "",
    notes: "",
  });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/super-admin/invoices?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load invoices");
      const json = await res.json();
      setRows(json.invoices || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [statusFilter]);

  async function invoiceAction(invoiceId: string, action: string) {
    try {
      const res = await fetch("/api/super-admin/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      toast.success("Invoice updated");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/super-admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: form.businessId,
          amount: parseFloat(form.amount),
          description: form.description,
          notes: form.notes || undefined,
          status: "sent",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      toast.success(`Invoice ${data.invoice?.invoiceNumber} created`);
      setCreateOpen(false);
      setForm({ businessId: "", amount: "", description: "", notes: "" });
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Invoices
            </CardTitle>
            <CardDescription>Create, send, and manage invoices for any tenant.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New invoice
            </Button>
            <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-xs font-mono">{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-sm">{inv.businessName}</TableCell>
                    <TableCell className="text-right text-sm">
                      {fmtMoney(inv.amount, inv.currency)}
                    </TableCell>
                    <TableCell className="text-sm capitalize">{inv.status}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(inv.dueDate)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {inv.status !== "paid" && inv.status !== "void" && (
                            <DropdownMenuItem
                              onClick={() => invoiceAction(inv.id, "mark_paid")}
                            >
                              Mark paid
                            </DropdownMenuItem>
                          )}
                          {inv.status === "draft" && (
                            <DropdownMenuItem
                              onClick={() => invoiceAction(inv.id, "mark_sent")}
                            >
                              Mark sent
                            </DropdownMenuItem>
                          )}
                          {inv.status !== "void" && (
                            <DropdownMenuItem onClick={() => invoiceAction(inv.id, "void")}>
                              Void
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create manual invoice</DialogTitle>
            <DialogDescription>Issue an invoice to a tenant business.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createInvoice} className="space-y-4">
            <div className="space-y-2">
              <Label>Business</Label>
              <Select
                value={form.businessId}
                onValueChange={(v) => setForm((f) => ({ ...f, businessId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (USD)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Pro plan — March 2026"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create invoice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
