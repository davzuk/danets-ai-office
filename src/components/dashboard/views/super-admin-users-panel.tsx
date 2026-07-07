"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Users,
  RefreshCw,
  Loader2,
  Search,
  MoreVertical,
  KeyRound,
  Trash2,
  LogIn,
  Shield,
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
  DropdownMenuSeparator,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  createdAt: string;
  business: { id: string; name: string; status: string; plan: string };
}

export function SuperAdminUsersPanel({
  businesses,
  onImpersonate,
}: {
  businesses: { id: string; name: string }[];
  onImpersonate?: (user: PlatformUser) => void;
}) {
  const [users, setUsers] = React.useState<PlatformUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [businessFilter, setBusinessFilter] = React.useState("all");
  const [resetTarget, setResetTarget] = React.useState<PlatformUser | null>(null);
  const [newPassword, setNewPassword] = React.useState("");
  const [resetting, setResetting] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PlatformUser | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (businessFilter !== "all") params.set("businessId", businessFilter);
      const res = await fetch(`/api/super-admin/users?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [debounced, businessFilter]);

  async function confirmReset() {
    if (!resetTarget || newPassword.length < 6) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/super-admin/users/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`Password reset for ${resetTarget.email}`);
      setResetTarget(null);
      setNewPassword("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/users/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${res.status})`);
      }
      toast.success(`Removed ${deleteTarget.email}`);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Cross-Tenant Users
              </CardTitle>
              <CardDescription>
                Manage users across all tenants — reset passwords, impersonate, or remove accounts.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-9 h-10"
              />
            </div>
            <Select value={businessFilter} onValueChange={setBusinessFilter}>
              <SelectTrigger className="w-full sm:w-[220px] h-10">
                <SelectValue placeholder="Tenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tenants</SelectItem>
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-6 pb-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">No users found.</div>
          ) : (
            <div className="max-h-[70vh] overflow-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="pl-6">User</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="pl-6">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {u.name}
                          {u.isSuperAdmin && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5">
                              <Shield className="h-2.5 w-2.5" /> Super
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{u.business.name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{u.business.plan}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {u.isSuperAdmin ? (
                          <span className="text-xs text-muted-foreground">Protected</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {onImpersonate && (
                                <DropdownMenuItem onClick={() => onImpersonate(u)}>
                                  <LogIn className="h-4 w-4 mr-2" />
                                  Impersonate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setResetTarget(u)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove User
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetTarget?.email}. They will need to use it on next login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 6 characters"
              minLength={6}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={confirmReset} disabled={resetting || newPassword.length < 6}>
              {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the user account from {deleteTarget?.business.name}. Active sessions will be revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
