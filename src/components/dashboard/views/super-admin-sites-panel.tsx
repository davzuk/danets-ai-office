"use client";

// Platform → Tenant sites (Phase 2, workstreams Q + R): every tenant website.
// The platform builds them (Edit opens the site builder, with the AI page
// builder), and can take one offline (abuse, unpaid, legal) and bring it back.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Globe, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiteBuilder } from "@/components/platform/site-builder";

interface SiteRow {
  id: string;
  subdomain: string;
  url: string | null;
  status: string;
  widgetEnabled: boolean;
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
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  if (editing) {
    return (
      <SiteBuilder
        siteId={editing}
        onBack={() => {
          setEditing(null);
          load(q);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" /> Tenant sites
          </CardTitle>
          <CardDescription>Websites the platform builds for tenants. Suspending one shows visitors a “not found” page.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business or address" className="w-56 pl-8" />
          </div>
          <Button variant="outline" size="icon" title="Refresh" onClick={() => load(q)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New site
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
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.pages} ({s.published})
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.views.toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.status === "active" ? "secondary" : "destructive"}>{s.status === "active" ? "Online" : "Suspended"}</Badge>
                    </td>
                    <td className="space-x-1 whitespace-nowrap py-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(s.id)}>
                        Edit
                      </Button>
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
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      {q ? "No sites match." : "No tenant has a website yet. Use New site to build one."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
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
      <NewSiteDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          setCreating(false);
          setEditing(id);
        }}
      />
    </Card>
  );
}

interface BusinessHit {
  id: string;
  name: string;
  email: string | null;
  plan: string;
}

/** Pick a business and an address, then open the new site in the builder. */
function NewSiteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (siteId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BusinessHit[]>([]);
  const [business, setBusiness] = useState<BusinessHit | null>(null);
  const [subdomain, setSubdomain] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || business) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/super-admin/businesses${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, { cache: "no-store" });
        const d = await r.json();
        setHits(r.ok ? (d.businesses ?? []).slice(0, 8) : []);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, business]);

  const pick = async (b: BusinessHit) => {
    setBusiness(b);
    try {
      const r = await fetch(`/api/super-admin/sites?suggest=${encodeURIComponent(b.id)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not check the business.");
      setSubdomain(d.subdomain ?? "");
      setDomain(d.sitesDomain ?? null);
      setExisting(d.existingSiteId ?? null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reset = () => {
    setBusiness(null);
    setSubdomain("");
    setExisting(null);
  };

  const create = async () => {
    if (!business) return;
    setBusy(true);
    try {
      const r = await fetch("/api/super-admin/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: business.id, subdomain }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not create the site.");
      toast.success(`${business.name}'s website is ready, with a starter home page.`);
      reset();
      setQ("");
      onCreated(d.site.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tenant site</DialogTitle>
          <DialogDescription>Each business can have one website. It starts with a draft home page.</DialogDescription>
        </DialogHeader>
        {!business ? (
          <div className="space-y-2">
            <Label htmlFor="ns-q">Business</Label>
            <Input id="ns-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" autoFocus />
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {hits.map((b) => (
                <li key={b.id}>
                  <button className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => pick(b)}>
                    <span className="font-medium">{b.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.email ?? "no email"} · {b.plan}
                    </span>
                  </button>
                </li>
              ))}
              {hits.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No businesses found.</li>}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{business.name}</span>
              <Button variant="ghost" size="sm" onClick={reset}>
                Change
              </Button>
            </div>
            {existing ? (
              <p className="text-sm">
                This business already has a website.{" "}
                <button className="font-medium text-primary hover:underline" onClick={() => onCreated(existing)}>
                  Open it
                </button>
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="ns-sub">Address</Label>
                <div className="flex items-center gap-2">
                  <Input id="ns-sub" value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase())} />
                  <span className="shrink-0 text-sm text-muted-foreground">.{domain ?? "…"}</span>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {business && !existing && (
            <Button onClick={create} disabled={busy || !subdomain}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create site
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
