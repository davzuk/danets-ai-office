"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ArrowLeft,
  Sparkles,
  Copy,
  Check,
  Send,
  Bot,
  User as UserIcon,
  Loader2,
  MessageSquare,
  Search,
  Mail,
  Phone,
  Clock,
  RefreshCw,
  AlertCircle,
  Tag,
  Download,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────

interface UserProp {
  userId: string;
  businessId: string;
  name: string;
  email: string;
  role: string;
  businessName: string;
}

interface LatestMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  service: string | null;
  quality: string | null;
  status: string;
}

interface ChatSessionListItem {
  id: string;
  businessId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  visitorPhone: string | null;
  visitorId: string | null;
  status: string;
  summary: string | null;
  leadQuality: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  lead: Lead | null;
  latestMessage: LatestMessage | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  tokensUsed?: number;
}

interface ChatSessionDetail {
  id: string;
  businessId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  visitorPhone: string | null;
  visitorId: string | null;
  status: string;
  summary: string | null;
  leadQuality: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  lead: Lead | null;
  messages: ChatMessage[];
}

interface SuggestionsResult {
  summary?: string;
  follow_up_message?: string;
  lead_quality?: "low" | "medium" | "high";
  next_action?: string;
  parsed: boolean;
  raw?: boolean;
  text?: string;
}

type StatusFilter = "all" | "active" | "ended" | "handover";

// ─── Main component ───────────────────────────────────────────────────

export function ConversationsView({ user }: { user: UserProp }) {
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [suggestions, setSuggestions] = useState<SuggestionsResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [followUpEdit, setFollowUpEdit] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch list ──────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/conversations?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      toast.error("Failed to load conversations");
      setSessions([]);
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Debounce search input -> search term
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch]);

  // ── Fetch detail when an item is selected ───────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSuggestions(null);
      setFollowUpEdit("");
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setSuggestions(null);
    setFollowUpEdit("");

    fetch(`/api/conversations/${selectedId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const s = data?.session;
        if (!s) {
          setDetail(null);
          toast.error("Conversation not found");
          setSelectedId(null);
          return;
        }
        setDetail(s);
        // Pre-populate suggestions display from previously-saved summary/nextAction
        if (s.summary || s.nextAction || s.leadQuality) {
          setSuggestions({
            summary: s.summary || undefined,
            next_action: s.nextAction || undefined,
            lead_quality: (s.leadQuality as "low" | "medium" | "high") || undefined,
            parsed: true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load conversation");
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Auto-scroll messages to bottom ──────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages?.length, selectedId]);

  // ── Generate AI suggestions ─────────────────────────────────────────
  async function generateSuggestions() {
    if (!selectedId) return;
    setGenerating(true);
    setSuggestions(null);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        toast.error(data?.error || "Failed to generate suggestions");
        setSuggestions(null);
        return;
      }
      const s: SuggestionsResult | null = data?.suggestions || null;
      setSuggestions(s);
      if (s?.parsed === false) {
        toast.info("AI returned raw text — could not parse JSON.");
      } else {
        toast.success("Suggestions generated");
      }
      if (s?.follow_up_message) setFollowUpEdit(s.follow_up_message);
      // refresh list to reflect updated summary/leadQuality
      fetchList();
    } catch {
      toast.error("Network error — try again");
    } finally {
      setGenerating(false);
    }
  }

  // ── Copy helper ─────────────────────────────────────────────────────
  async function copyText(text: string, label = "Copied to clipboard") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select text manually");
    }
  }

  // ── Download transcript ─────────────────────────────────────────────
  function downloadTranscript() {
    if (!detail) return;
    toast.success("Downloading transcript…");
    const url = `/api/conversations/${detail.id}/export`;
    // Same-origin request → the danets_session cookie is sent automatically.
    // Server returns Content-Disposition: attachment, so the browser will
    // trigger a file download instead of navigating.
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ─── Render ─────────────────────────────────────────────────────────

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "ended", label: "Ended" },
    { key: "handover", label: "Handover" },
  ];

  const showDetailOnMobile = !!selectedId;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-9rem)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Review chat sessions, view transcripts, and generate AI suggested replies.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchList}
          disabled={loadingList}
        >
          <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        {/* ── LEFT: list ─────────────────────────────────────────────── */}
        <aside
          className={cn(
            "w-full lg:w-80 xl:w-96 shrink-0 flex flex-col bg-card border rounded-xl overflow-hidden",
            showDetailOnMobile && "hidden lg:flex"
          )}
        >
          {/* Search */}
          <div className="p-3 border-b">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name or email…"
                className="pl-8 h-9"
              />
            </div>
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {statusFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                    statusFilter === f.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scroll-thin">
            {loadingList ? (
              <ListSkeleton />
            ) : sessions.length === 0 ? (
              <EmptyList />
            ) : (
              <ul className="divide-y">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className={cn(
                        "w-full text-left p-3 hover:bg-accent/30 transition-colors flex gap-3 items-start",
                        selectedId === s.id && "bg-accent/40"
                      )}
                    >
                      <Avatar className="size-9 shrink-0">
                        <AvatarFallback className="brand-gradient text-white text-xs font-semibold">
                          {initials(visitorLabel(s))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">
                            {visitorLabel(s)}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {timeAgo(s.updatedAt)}
                          </span>
                        </div>
                        {s.visitorEmail && (
                          <div className="text-xs text-muted-foreground truncate">
                            {s.visitorEmail}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {s.latestMessage?.content || (
                            <span className="italic">No messages yet</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <StatusBadge status={s.status} />
                          {s.leadQuality && (
                            <LeadQualityBadge quality={s.leadQuality} />
                          )}
                          {s.lead && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1.5"
                            >
                              <Tag size={9} /> lead
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── RIGHT: detail ─────────────────────────────────────────── */}
        <section
          className={cn(
            "flex-1 min-w-0 flex flex-col bg-card border rounded-xl overflow-hidden",
            !showDetailOnMobile && "hidden lg:flex"
          )}
        >
          {!selectedId ? (
            <EmptyDetail />
          ) : loadingDetail ? (
            <DetailSkeleton />
          ) : !detail ? (
            <EmptyDetail />
          ) : (
            <>
              {/* Header */}
              <header className="px-4 py-3 border-b flex items-center gap-3 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="lg:hidden -ml-2"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft size={18} />
                </Button>
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="brand-gradient text-white text-sm font-semibold">
                    {initials(visitorLabel(detail))}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">
                      {visitorLabel(detail)}
                    </span>
                    <StatusBadge status={detail.status} />
                    {detail.leadQuality && (
                      <LeadQualityBadge quality={detail.leadQuality} />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mt-0.5">
                    {detail.visitorEmail && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={11} /> {detail.visitorEmail}
                      </span>
                    )}
                    {detail.visitorPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={11} /> {detail.visitorPhone}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} /> {timeAgo(detail.updatedAt)}
                    </span>
                    {detail.lead && (
                      <span className="inline-flex items-center gap-1">
                        <Tag size={11} /> {detail.lead.service || "lead captured"}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadTranscript}
                  disabled={!detail}
                  className="gap-1.5 shrink-0"
                  title="Download transcript (.txt)"
                >
                  <Download size={14} />
                  <span className="hidden md:inline">Download transcript</span>
                </Button>
              </header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto scroll-thin p-4 bg-muted/30">
                <div className="flex flex-col gap-3 max-w-3xl mx-auto">
                  {detail.messages.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-12">
                      <MessageSquare size={32} className="mx-auto mb-2 opacity-40" />
                      No messages in this conversation.
                    </div>
                  ) : (
                    detail.messages.map((m) => (
                      <MessageBubble key={m.id} message={m} />
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* AI Suggested Replies panel */}
              <div className="shrink-0 border-t bg-background p-3 lg:p-4">
                <Card className="border-primary/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-md brand-gradient flex items-center justify-center text-white">
                          <Sparkles size={14} />
                        </div>
                        <div>
                          <CardTitle className="text-sm">
                            AI Suggested Replies
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Review and copy/send manually — auto-send is disabled.
                          </CardDescription>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={generateSuggestions}
                        disabled={generating}
                      >
                        {generating ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Generating…
                          </>
                        ) : suggestions ? (
                          <>
                            <RefreshCw size={14} />
                            Regenerate
                          </>
                        ) : (
                          <>
                            <Sparkles size={14} />
                            Generate suggestions
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {generating ? (
                      <SuggestionsSkeleton />
                    ) : !suggestions ? (
                      <div className="text-sm text-muted-foreground py-3 px-1">
                        Click <span className="font-medium">Generate suggestions</span> to
                        analyze this conversation with AI. You&apos;ll get a summary,
                        a suggested follow-up message, lead quality, and a recommended
                        next action.
                      </div>
                    ) : suggestions.parsed === false ? (
                      <div className="space-y-3">
                        <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                          <AlertCircle size={14} className="mt-0.5 shrink-0" />
                          <span>
                            The AI did not return valid JSON. Showing the raw response
                            below. You can still copy it manually.
                          </span>
                        </div>
                        <Textarea
                          readOnly
                          value={suggestions.text || ""}
                          className="h-48 text-xs font-mono"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            copyText(suggestions.text || "", "Raw text copied")
                          }
                        >
                          <Copy size={14} /> Copy raw text
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Summary */}
                        {suggestions.summary && (
                          <SuggestionField
                            label="Summary"
                            icon={<MessageSquare size={12} />}
                          >
                            <p className="text-sm leading-relaxed">
                              {suggestions.summary}
                            </p>
                          </SuggestionField>
                        )}

                        {/* Follow-up message */}
                        {suggestions.follow_up_message && (
                          <SuggestionField
                            label="Suggested follow-up message"
                            icon={<Send size={12} />}
                            action={
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                onClick={() =>
                                  copyText(
                                    followUpEdit || suggestions.follow_up_message!,
                                    "Follow-up message copied"
                                  )
                                }
                              >
                                {copied ? (
                                  <Check size={12} />
                                ) : (
                                  <Copy size={12} />
                                )}
                                Copy
                              </Button>
                            }
                          >
                            <Textarea
                              value={followUpEdit}
                              onChange={(e) => setFollowUpEdit(e.target.value)}
                              className="min-h-[80px] text-sm"
                            />
                          </SuggestionField>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Lead quality */}
                          <SuggestionField
                            label="Lead quality"
                            icon={<Tag size={12} />}
                          >
                            {suggestions.lead_quality ? (
                              <LeadQualityBadge
                                quality={suggestions.lead_quality}
                                size="md"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Not assessed
                              </span>
                            )}
                          </SuggestionField>

                          {/* Next action */}
                          <SuggestionField
                            label="Recommended next action"
                            icon={<Sparkles size={12} />}
                          >
                            <p className="text-sm leading-relaxed">
                              {suggestions.next_action || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </p>
                          </SuggestionField>
                        </div>

                        <Separator />

                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <AlertCircle size={11} />
                          Auto-send is disabled. Copy the follow-up message and send it
                          manually via email, WhatsApp, or your CRM.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {message.content} · {time}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Bot size={14} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm break-words",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-background border rounded-bl-sm"
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <div
          className={cn(
            "text-[10px] mt-1",
            isUser ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {time}
        </div>
      </div>
      {isUser && (
        <div className="size-7 rounded-full bg-accent text-accent-foreground flex items-center justify-center shrink-0">
          <UserIcon size={14} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: {
      label: "Active",
      className: "bg-accent text-accent-foreground border-transparent",
    },
    ended: {
      label: "Ended",
      className:
        "bg-secondary text-secondary-foreground border-transparent",
    },
    handover: {
      label: "Handover",
      className: "bg-amber-500 text-white border-transparent",
    },
  };
  const cfg = map[status] || {
    label: status,
    className: "bg-secondary text-secondary-foreground border-transparent",
  };
  return (
    <Badge className={cn("text-[10px] h-4 px-1.5", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

function LeadQualityBadge({
  quality,
  size = "sm",
}: {
  quality: string;
  size?: "sm" | "md";
}) {
  const map: Record<string, { label: string; className: string }> = {
    low: {
      label: "Low",
      className:
        "bg-secondary text-secondary-foreground border-transparent",
    },
    medium: {
      label: "Medium",
      className: "bg-primary/15 text-primary border-transparent",
    },
    high: {
      label: "High",
      className: "bg-accent text-accent-foreground border-transparent",
    },
  };
  const cfg = map[quality] || {
    label: quality,
    className: "bg-secondary text-secondary-foreground border-transparent",
  };
  return (
    <Badge
      className={cn(
        size === "md" ? "text-xs h-5 px-2" : "text-[10px] h-4 px-1.5",
        cfg.className
      )}
    >
      <Tag size={size === "md" ? 11 : 9} /> {cfg.label} quality
    </Badge>
  );
}

function SuggestionField({
  label,
  icon,
  children,
  action,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="p-3 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="p-4 border-b flex gap-3 items-center">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              i % 2 === 0 ? "justify-end" : "justify-start"
            )}
          >
            <Skeleton className="h-14 w-3/5 rounded-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    </div>
  );
}

function EmptyList() {
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      <MessageSquare size={28} className="mx-auto mb-2 opacity-40" />
      No conversations found.
      <div className="text-xs mt-1">
        Try changing the filter or search term.
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <div className="size-14 rounded-2xl brand-gradient flex items-center justify-center text-white mx-auto mb-3">
          <MessageSquare size={24} />
        </div>
        <h3 className="font-medium">Select a conversation</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
          Choose a chat from the list to view its transcript, then generate AI
          suggested replies for your team.
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function visitorLabel(s: {
  visitorName: string | null;
  visitorEmail: string | null;
  visitorId: string | null;
}): string {
  if (s.visitorName && s.visitorName.trim()) return s.visitorName.trim();
  if (s.visitorEmail && s.visitorEmail.trim()) return s.visitorEmail.trim();
  if (s.visitorId) return `Visitor ${s.visitorId.slice(-4)}`;
  return "Anonymous visitor";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
