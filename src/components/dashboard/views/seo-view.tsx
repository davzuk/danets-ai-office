"use client";

// SEO (Phase 3). Workstream U: Setup. Connect Google, then pick the Search
// Console property and the Business Profile locations Danets reports on.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, Globe, Loader2, MapPin, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SeoPerformanceView } from "./seo-performance-view";
import { SeoAuditView } from "./seo-audit-view";
import { SeoReviewsView } from "./seo-reviews-view";

interface Connection {
  id: string;
  accountName: string | null;
  accountEmail: string | null;
  status: string;
  searchConsole: boolean;
  businessProfile: boolean;
}

interface Property {
  id: string;
  connectionId: string;
  siteUrl: string;
  permission: string;
  status: string;
  error: string | null;
  lastCheckedAt: string | null;
}

interface Location {
  id: string;
  connectionId: string;
  title: string;
  address: string | null;
  mapsUri: string | null;
  status: string;
  error: string | null;
  lastCheckedAt: string | null;
}

interface SetupData {
  googleConfigured: boolean;
  canEdit: boolean;
  connections: Connection[];
  properties: Property[];
  locations: Location[];
  limits: { properties: { used: number; limit: number }; locations: { used: number; limit: number } };
}

interface SiteOption {
  siteUrl: string;
  permission: string;
  kind: "domain" | "url_prefix";
  label: string;
  added: boolean;
}

interface LocationOption {
  accountName: string;
  accountLabel: string;
  locationName: string;
  title: string;
  address: string | null;
  added: boolean;
}

async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

const PERMISSION_LABELS: Record<string, string> = { siteOwner: "Owner", siteFullUser: "Full user", siteRestrictedUser: "Restricted user" };
const accountLabel = (c: Connection) => c.accountEmail || c.accountName || "Google account";
const limitText = (q: { used: number; limit: number }) => (q.limit > 0 ? `${q.used} of ${q.limit}` : `${q.used}`);

/** One-time message after coming back from Google's consent screen. */
function useConnectResult() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("purpose") !== "seo") return;
    const status = q.get("status");
    const reason = q.get("reason");
    if (status === "connected") toast.success("Google connected. Now choose your property and locations.");
    else if (reason === "seo_scopes") toast.error("Google was connected without Search Console or Business Profile access. Connect again and leave both boxes ticked.");
    else if (reason === "denied") toast.error("Google connection was cancelled.");
    else if (status === "error") toast.error("Google couldn't be connected. Please try again.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
}

export function SeoView() {
  const [tab, setTab] = useState<"setup" | "performance" | "audit" | "reviews">(() => {
    // A notification can ask to land on a tab (read once).
    try {
      const t = sessionStorage.getItem("seo-tab");
      sessionStorage.removeItem("seo-tab");
      if (t === "audit" || t === "performance" || t === "reviews") return t;
    } catch {}
    return "setup";
  });
  const [data, setData] = useState<SetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useConnectResult();

  const load = useCallback(async () => {
    try {
      setData(await api<SetupData>("/api/seo/setup"));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const d = await api<Omit<SetupData, "canEdit">>("/api/seo/check", { method: "POST" });
      setData((prev) => (prev ? { ...prev, ...d } : prev));
      toast.success("Checked with Google.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="inline-flex items-center gap-1 rounded-lg border p-0.5">
        <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
          Setup
        </TabButton>
        <TabButton active={tab === "performance"} onClick={() => setTab("performance")}>
          Performance
        </TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
          Audit
        </TabButton>
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>
          Reviews
        </TabButton>
      </div>

      {tab === "performance" ? (
        <SeoPerformanceView />
      ) : tab === "audit" ? (
        <SeoAuditView />
      ) : tab === "reviews" ? (
        <SeoReviewsView />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">SEO &amp; Search Visibility</h1>
              <p className="text-sm text-muted-foreground">How people find you on Google. Start by connecting your Search Console property and Business Profile.</p>
            </div>
            {data.canEdit && data.properties.length + data.locations.length > 0 && (
              <Button variant="outline" size="sm" onClick={checkNow} disabled={checking}>
                {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check access
              </Button>
            )}
          </div>
          <GoogleCard data={data} />
          <PropertiesCard data={data} onChange={load} />
          <LocationsCard data={data} onChange={load} />
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? "secondary" : "ghost"} className="h-8" onClick={onClick}>
      {children}
    </Button>
  );
}

// ─── Google connection ───────────────────────────────────────────────

function GoogleCard({ data }: { data: SetupData }) {
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const d = await api<{ url: string }>("/api/connections/google/start", { method: "POST", json: { purpose: "seo" } });
      window.location.assign(d.url);
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" /> Google account
          </CardTitle>
          <CardDescription>Danets reads Search Console data and manages your Business Profile through this account. It never changes your website.</CardDescription>
        </div>
        {data.canEdit && data.googleConfigured && (
          <Button size="sm" variant={data.connections.length ? "outline" : "default"} onClick={connect} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {data.connections.length ? "Connect another account" : "Connect Google"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!data.googleConfigured && <p className="text-sm text-muted-foreground">Google sign-in isn&apos;t set up on this server yet. Ask your platform administrator to add the Google OAuth credentials.</p>}
        {data.googleConfigured && data.connections.length === 0 && <p className="text-sm text-muted-foreground">No Google account connected yet.</p>}
        {data.connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{accountLabel(c)}</span>
            <div className="flex flex-wrap gap-1.5">
              {c.status !== "active" && <Badge variant="destructive">Reconnect needed</Badge>}
              <Badge variant={c.searchConsole ? "secondary" : "outline"}>{c.searchConsole ? "Search Console" : "No Search Console access"}</Badge>
              <Badge variant={c.businessProfile ? "secondary" : "outline"}>{c.businessProfile ? "Business Profile" : "No Business Profile access"}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatusLine({ status, error, lastCheckedAt }: { status: string; error: string | null; lastCheckedAt: string | null }) {
  if (status === "active")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected{lastCheckedAt ? ` · checked ${new Date(lastCheckedAt).toLocaleString()}` : ""}
      </span>
    );
  return (
    <span className="inline-flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {error || (status === "lost_access" ? "Access lost." : "Last check failed.")}
    </span>
  );
}

/** Pick which connection to browse with when there are several. */
function ConnectionPicker({ connections, value, onChange }: { connections: Connection[]; value: string; onChange: (id: string) => void }) {
  if (connections.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {connections.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {accountLabel(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Search Console ──────────────────────────────────────────────────

function PropertiesCard({ data, onChange }: { data: SetupData; onChange: () => void }) {
  const usable = data.connections.filter((c) => c.status === "active" && c.searchConsole);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<Property | null>(null);
  const q = data.limits.properties;
  const full = q.limit > 0 && q.used >= q.limit;

  const remove = async () => {
    if (!removing) return;
    try {
      await api(`/api/seo/properties/${removing.id}`, { method: "DELETE" });
      toast.success("Property removed.");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" /> Search Console property
          </CardTitle>
          <CardDescription>The website whose Google search data you see here. A domain property covers every subdomain. {limitText(q)} used on your plan.</CardDescription>
        </div>
        {data.canEdit && usable.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setPicking(true)} disabled={full} title={full ? "Your plan's limit is reached" : undefined}>
            <Plus className="mr-2 h-4 w-4" />
            Add property
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {data.properties.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {usable.length ? "No property added yet." : "Connect a Google account with Search Console access first. If your site isn't in Search Console yet, add and verify it there."}
          </p>
        )}
        {data.properties.map((p) => (
          <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {p.siteUrl.replace(/^sc-domain:/, "")}
                <Badge variant="outline">{p.siteUrl.startsWith("sc-domain:") ? "Domain" : "URL prefix"}</Badge>
                <span className="text-xs font-normal text-muted-foreground">{PERMISSION_LABELS[p.permission] ?? p.permission}</span>
              </div>
              <StatusLine status={p.status} error={p.error} lastCheckedAt={p.lastCheckedAt} />
            </div>
            {data.canEdit && (
              <Button variant="ghost" size="icon" title="Remove" onClick={() => setRemoving(p)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      {picking && (
        <SitePicker
          connections={usable}
          onClose={() => setPicking(false)}
          onAdded={() => {
            setPicking(false);
            onChange();
          }}
        />
      )}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.siteUrl.replace(/^sc-domain:/, "")}?</AlertDialogTitle>
            <AlertDialogDescription>Danets stops reading its search data. Nothing changes in Search Console.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SitePicker({ connections, onClose, onAdded }: { connections: Connection[]; onClose: () => void; onAdded: () => void }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ sites: SiteOption[] }>(`/api/seo/google/sites?connectionId=${encodeURIComponent(connectionId)}`)
      .then((d) => live && (setSites(d.sites), setError(null)))
      .catch((e) => live && (setSites([]), setError(e.message)));
    return () => {
      live = false;
    };
  }, [connectionId]);

  const add = async (s: SiteOption) => {
    setBusy(s.siteUrl);
    try {
      await api("/api/seo/properties", { method: "POST", json: { connectionId, siteUrl: s.siteUrl } });
      toast.success(`${s.label} added.`);
      onAdded();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a Search Console property</DialogTitle>
          <DialogDescription>Properties this Google account can read. Domain properties are listed first.</DialogDescription>
        </DialogHeader>
        <ConnectionPicker
          connections={connections}
          value={connectionId}
          onChange={(id) => {
            setSites(null);
            setConnectionId(id);
          }}
        />
        {!sites ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This account can&apos;t read any properties.{" "}
            <a className="text-primary hover:underline" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">
              Open Search Console <ExternalLink className="inline h-3 w-3" />
            </a>{" "}
            to add and verify your site, then try again.
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {sites.map((s) => (
              <li key={s.siteUrl} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.kind === "domain" ? "Domain property" : "URL-prefix property"} · {PERMISSION_LABELS[s.permission] ?? s.permission}
                  </div>
                </div>
                {s.added ? (
                  <Badge variant="secondary">Added</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => add(s)}>
                    {busy === s.siteUrl && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Business Profile ────────────────────────────────────────────────

function LocationsCard({ data, onChange }: { data: SetupData; onChange: () => void }) {
  const usable = data.connections.filter((c) => c.status === "active" && c.businessProfile);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<Location | null>(null);
  const q = data.limits.locations;
  const full = q.limit > 0 && q.used >= q.limit;

  const remove = async () => {
    if (!removing) return;
    try {
      await api(`/api/seo/locations/${removing.id}`, { method: "DELETE" });
      toast.success("Location removed.");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> Business Profile locations
          </CardTitle>
          <CardDescription>Your listings on Google Search and Maps, for reviews, posts and local stats. {limitText(q)} used on your plan.</CardDescription>
        </div>
        {data.canEdit && usable.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setPicking(true)} disabled={full} title={full ? "Your plan's limit is reached" : undefined}>
            <Plus className="mr-2 h-4 w-4" />
            Add location
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {data.locations.length === 0 && (
          <p className="text-sm text-muted-foreground">{usable.length ? "No location added yet." : "Connect a Google account that manages your Business Profile first."}</p>
        )}
        {data.locations.map((l) => (
          <div key={l.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {l.title}
                {l.mapsUri && (
                  <a href={l.mapsUri} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open in Google Maps">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              {l.address && <div className="text-xs text-muted-foreground">{l.address}</div>}
              <StatusLine status={l.status} error={l.error} lastCheckedAt={l.lastCheckedAt} />
            </div>
            {data.canEdit && (
              <Button variant="ghost" size="icon" title="Remove" onClick={() => setRemoving(l)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      {picking && (
        <LocationPicker
          connections={usable}
          onClose={() => setPicking(false)}
          onAdded={() => {
            setPicking(false);
            onChange();
          }}
        />
      )}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.title}?</AlertDialogTitle>
            <AlertDialogDescription>Danets stops managing this location. Nothing changes on Google.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LocationPicker({ connections, onClose, onAdded }: { connections: Connection[]; onClose: () => void; onAdded: () => void }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ locations: LocationOption[] }>(`/api/seo/google/locations?connectionId=${encodeURIComponent(connectionId)}`)
      .then((d) => live && (setLocations(d.locations), setError(null)))
      .catch((e) => live && (setLocations([]), setError(e.message)));
    return () => {
      live = false;
    };
  }, [connectionId]);

  const add = async (l: LocationOption) => {
    setBusy(l.locationName);
    try {
      await api("/api/seo/locations", { method: "POST", json: { connectionId, accountName: l.accountName, locationName: l.locationName } });
      toast.success(`${l.title} added.`);
      onAdded();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a Business Profile location</DialogTitle>
          <DialogDescription>Locations this Google account manages.</DialogDescription>
        </DialogHeader>
        <ConnectionPicker
          connections={connections}
          value={connectionId}
          onChange={(id) => {
            setLocations(null);
            setConnectionId(id);
          }}
        />
        {!locations ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">This account doesn&apos;t manage any Business Profile locations.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {locations.map((l) => (
              <li key={l.locationName} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{[l.address, l.accountLabel].filter(Boolean).join(" · ")}</div>
                </div>
                {l.added ? (
                  <Badge variant="secondary">Added</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => add(l)}>
                    {busy === l.locationName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
