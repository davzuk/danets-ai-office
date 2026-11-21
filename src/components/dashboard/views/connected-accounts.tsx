"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Unlink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { SocialAccountRows, type SocialAccountView } from "./social-account-rows";

interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  configured: boolean;
}

interface Connection {
  id: string;
  provider: string;
  accountName: string | null;
  accountEmail: string | null;
  scopes: string[];
  status: "active" | "expired" | "revoked" | "error";
  expiresAt: string | null;
  lastError: string | null;
  assets: {
    id: string;
    name: string;
    instagram?: { id: string; username: string | null } | null;
  }[];
}

const STATUS_STYLE: Record<Connection["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  expired: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  revoked: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

const CALLBACK_ERRORS: Record<string, string> = {
  denied: "You cancelled the request on the provider's consent screen.",
  state: "The connect request expired or didn't match. Please try again.",
  forbidden: "Only workspace admins can connect accounts.",
  rejected: "The provider rejected the request. Please try again.",
  provider: "The provider couldn't be reached. Please try again shortly.",
  missing_code: "The provider didn't return an authorization code.",
};

/** OAuth-connected accounts (Meta, Google) for the Integrations page. */
export function ConnectedAccounts() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountView[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Connection | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load connected accounts");
      setProviders(data.providers ?? []);
      setConnections(data.connections ?? []);
      setSocialAccounts(data.socialAccounts ?? []);
      setCanManage(!!data.canManage);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load connected accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Result of the OAuth round-trip (?connection=meta&status=connected|error&reason=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("connection");
    const status = params.get("status");
    if (!provider || !status) return;
    const conflicts = Number(params.get("conflicts") ?? 0);
    if (status === "connected") toast.success("Account connected");
    if (status === "connected" && conflicts > 0) {
      toast.warning(
        `${conflicts} page${conflicts === 1 ? " is" : "s are"} already connected to another Danets workspace`,
        {
          description: "Disconnect it there first, then reconnect here to manage it from this workspace.",
        },
      );
    } else
      toast.error("Couldn't connect the account", {
        description: CALLBACK_ERRORS[params.get("reason") ?? ""],
      });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function connect(providerId: string) {
    setBusy(providerId);
    try {
      const res = await fetch(`/api/connections/${providerId}/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start the connection");
      window.location.assign(data.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not start the connection");
      setBusy(null);
    }
  }

  async function disconnect(conn: Connection) {
    setBusy(conn.id);
    try {
      const res = await fetch(`/api/connections/accounts/${conn.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not disconnect");
      toast.success("Account disconnected");
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
      setSocialAccounts((prev) => prev.filter((a) => a.connectionId !== conn.id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setBusy(null);
      setToRemove(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="size-4" /> Connected accounts
        </CardTitle>
        <CardDescription>
          Sign in to your social and search accounts so Danets can capture leads and publish for you. Tokens are
          encrypted and never shown in the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          providers.map((p) => {
            const conns = connections.filter((c) => c.provider === p.id);
            return (
              <div key={p.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant={conns.length ? "outline" : "default"}
                      disabled={!p.configured || busy === p.id}
                      title={p.configured ? undefined : "Not configured on this server yet"}
                      onClick={() => connect(p.id)}
                    >
                      {busy === p.id && <Loader2 className="size-4 animate-spin" />}
                      {conns.length ? "Connect another" : "Connect"}
                    </Button>
                  ) : null}
                </div>

                {!p.configured && (
                  <p className="text-xs text-muted-foreground">
                    Not available yet: the platform administrator hasn&apos;t set up the {p.label} app.
                  </p>
                )}

                {conns.map((c) => {
                  const assets = socialAccounts.filter((a) => a.connectionId === c.id);
                  return (
                    <div key={c.id} className="space-y-3 rounded-md bg-muted/40 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">
                              {c.accountName ?? c.accountEmail ?? "Account"}
                            </span>
                            <Badge className={STATUS_STYLE[c.status]} variant="secondary">
                              {c.status}
                            </Badge>
                          </div>
                          {assets.length === 0 && c.assets.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {c.assets.length} page
                              {c.assets.length === 1 ? "" : "s"}:{" "}
                              {c.assets
                                .map((a) => (a.instagram?.username ? `${a.name} (@${a.instagram.username})` : a.name))
                                .join(", ")}
                            </div>
                          )}
                          {c.expiresAt && c.status === "active" && (
                            <div className="text-xs text-muted-foreground">
                              Access renews{" "}
                              {c.provider === "meta" ? "until" : "automatically; current token valid until"}{" "}
                              {new Date(c.expiresAt).toLocaleDateString()}
                            </div>
                          )}
                          {c.status !== "active" && c.lastError && (
                            <div className="text-xs text-destructive flex items-start gap-1">
                              <AlertTriangle className="size-3 mt-0.5 shrink-0" /> {c.lastError}
                            </div>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex gap-2 shrink-0">
                            {c.status !== "active" && p.configured && (
                              <Button size="sm" onClick={() => connect(p.id)} disabled={busy === p.id}>
                                Reconnect
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setToRemove(c)} disabled={busy === c.id}>
                              {busy === c.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Unlink className="size-4" />
                              )}
                              Disconnect
                            </Button>
                          </div>
                        )}
                      </div>
                      <SocialAccountRows
                        accounts={assets}
                        canManage={canManage}
                        onChange={(next) => setSocialAccounts((prev) => prev.map((a) => (a.id === next.id ? next : a)))}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {!loading && !canManage && (
          <p className="text-xs text-muted-foreground">Only workspace admins can connect or disconnect accounts.</p>
        )}
      </CardContent>

      <AlertDialog open={!!toRemove} onOpenChange={(open) => !open && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {toRemove?.accountName ?? "this account"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Danets will revoke its access at the provider and stop syncing. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toRemove && disconnect(toRemove)}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
