"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  UserPlus,
  MoreVertical,
  Trash2,
  Shield,
  User as UserIcon,
  Loader2,
  Crown,
  Mail,
} from "lucide-react";
import { toast } from "sonner";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export function TeamMembers({
  businessId,
  currentUserRole,
  currentUserId,
}: {
  businessId: string;
  currentUserRole: string;
  currentUserId: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "member" as "admin" | "member",
    password: "",
  });

  const isAdmin = currentUserRole === "admin";

  async function fetchMembers() {
    try {
      const r = await fetch("/api/team", { cache: "no-store" });
      const d = await r.json();
      setMembers(d.members || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMembers();
  }, [businessId]);

  async function invite() {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      toast.error("Fill all fields (password min 6 chars)");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(`${form.name} added to the team`);
      setMembers([...members, d.member]);
      setInviteOpen(false);
      setForm({ name: "", email: "", role: "member", password: "" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: Member, role: "admin" | "member") {
    try {
      const r = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(`${member.name} is now ${role}`);
      setMembers(members.map((m) => (m.id === member.id ? { ...m, role } : m)));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    try {
      const r = await fetch(`/api/team/${removeTarget.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(`${removeTarget.name} removed from team`);
      setMembers(members.filter((m) => m.id !== removeTarget.id));
      setRemoveTarget(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <UserIcon size={16} /> Team Members
          </CardTitle>
          <CardDescription>
            People who can access this dashboard
          </CardDescription>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
            <UserPlus size={15} />
            <span className="hidden sm:inline">Invite</span>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No team members yet.
          </p>
        ) : (
          members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors group"
            >
              <Avatar className="h-9 w-9 border">
                <AvatarFallback
                  className={m.role === "admin" ? "brand-gradient text-white" : "bg-muted"}
                >
                  {m.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{m.name}</span>
                  {m.id === currentUserId && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      You
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <Mail size={11} />
                  {m.email}
                </div>
              </div>
              <Badge
                variant={m.role === "admin" ? "default" : "secondary"}
                className="gap-1"
              >
                {m.role === "admin" ? (
                  <Crown size={11} />
                ) : (
                  <Shield size={11} />
                )}
                {m.role}
              </Badge>
              {isAdmin && m.id !== currentUserId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical size={15} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {m.role === "member" ? (
                      <DropdownMenuItem onClick={() => changeRole(m, "admin")}>
                        <Crown size={14} className="mr-2" /> Make admin
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => changeRole(m, "member")}>
                        <Shield size={14} className="mr-2" /> Make member
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setRemoveTarget(m)}
                    >
                      <Trash2 size={14} className="mr-2" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Only admins can invite or remove team members.
          </p>
        )}
      </CardContent>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
            <DialogDescription>
              Add a new person to your business dashboard. They can sign in with
              the email and password you set.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Doe"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@company.com"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Temporary password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 6 characters"
                className="h-10"
              />
              <p className="text-[11px] text-muted-foreground">
                Ask them to change it after first sign-in.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: "member" })}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                    form.role === "member"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <Shield size={16} className="text-muted-foreground" />
                  <span className="text-sm font-medium">Member</span>
                  <span className="text-[10px] text-muted-foreground">Can view & manage</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: "admin" })}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                    form.role === "admin"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <Crown size={16} className="text-accent-foreground" />
                  <span className="text-sm font-medium">Admin</span>
                  <span className="text-[10px] text-muted-foreground">Full access + team</span>
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={invite} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke their access to the dashboard and delete their
              account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
