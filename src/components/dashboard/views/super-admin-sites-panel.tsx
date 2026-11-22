"use client";

// Platform → Tenant sites (Phase 2, workstream Q): every tenant website, with
// a way to take one offline (abuse, unpaid, legal) and bring it back.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Globe, Loader2, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface SiteRow {
  id: string;
  subdomain: string;
  url: string | null;
  status: string;
  widgetEnabled: boolean;
  customDomain: string | null;
  domainStatus: string;
  domainError: string | null;
  createdAt: string;
  business: { id: string; name: string; status: string };
  pages: number;
  published: number;
  views: number;
}

export function SuperAdminSitesPanel() {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [q, setQ] = useState("");
  const [suspending, setSuspending] = useState<SiteRow | null>(null);
  // What the dialog shows; kept while it fades out after closing.
  const [target, setTarget] = useState<SiteRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<SiteRow | null>(null);

  const removeDomain = async (site: SiteRow) => {
    setBusy(site.id);
    try {
      const r = await fetch(`/api/super-admin/sites/${site.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ removeDomain: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not remove the domain.");
      toast.success(`${site.customDomain} disconnected.`);
      load(q);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setUnlinking(null);
    }
  };

  const load = useCallback(async (query: string) => {
    try {
      const r = await fetch(`/api/super-admin/sites${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load sites.");
      setSites(d.sites);
    } catch (e: any) {
      toast.error(e.message);
      setSites([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const setStatus = async (site: SiteRow, status: "active" | "suspended", why?: string) => {
    setBusy(site.id);
    try {
      const r = await fetch(`/api/super-admin/sites/${site.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason: why || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not update the site.");
      toast.success(status === "suspended" ? `${site.subdomain} is offline.` : `${site.subdomain} is back online.`);
      setSuspending(null);
      setReason("");
      load(q);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" /> Tenant sites
          </CardTitle>
          <CardDescription>Websites tenants have built. Suspending one shows visitors a “not found” page; the tenant keeps their drafts.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business or address" className="w-56 pl-8" />
          </div>
          <Button variant="outline" size="icon" title="Refresh" onClick={() => load(q)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!sites ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">Address</th>
                  <th className="py-2 pr-3 font-medium">Custom domain</th>
                  <th className="py-2 pr-3 text-right font-medium">Pages (live)</th>
                  <th className="py-2 pr-3 text-right font-medium">Views</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{s.business.name}</div>
                      {s.business.status !== "active" && <div className="text-xs text-muted-foreground">Business {s.business.status}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                          {s.subdomain}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        s.subdomain
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {s.customDomain ? (
                        <div className="flex items-center gap-2">
                          <span title={s.domainError ?? undefined}>{s.customDomain}</span>
                          <Badge variant={s.domainStatus === "verified" ? "secondary" : s.domainStatus === "failed" ? "destructive" : "outline"}>
                            {s.domainStatus === "verified" ? "Verified" : s.domainStatus === "failed" ? "Failed" : "Pending"}
                          </Badge>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy === s.id} onClick={() => setUnlinking(s)}>
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.pages} ({s.published})
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.views.toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.status === "active" ? "secondary" : "destructive"}>{s.status === "active" ? "Online" : "Suspended"}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      {s.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setTarget(s);
                            setSuspending(s);
                          }}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" disabled={busy === s.id} onClick={() => setStatus(s, "active")}>
                          {busy === s.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Restore
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {sites.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      {q ? "No sites match." : "No tenant has set up a website yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <AlertDialog open={!!unlinking} onOpenChange={(o) => !o && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {unlinking?.customDomain}?</AlertDialogTitle>
            <AlertDialogDescription>
              The website stops answering on that domain and goes back to its Danets address. The tenant can add the domain again with new DNS records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlinking && removeDomain(unlinking)}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!suspending} onOpenChange={(o) => !o && setSuspending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {target?.subdomain}?</DialogTitle>
            <DialogDescription>Every page of {target?.business.name}&apos;s website goes offline straight away. The tenant sees why in their activity log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Reason (optional)</Label>
            <Textarea id="suspend-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!busy} onClick={() => suspending && setStatus(suspending, "suspended", reason)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Suspend site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
