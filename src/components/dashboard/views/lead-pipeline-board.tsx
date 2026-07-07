"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Users,
  Phone,
  Mail,
  Clock,
  GripVertical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  service: string | null;
  message: string | null;
  quality: string;
  status: string;
  source: string;
  dealValue?: number;
  company?: string | null;
  createdAt: string;
}

const COLUMNS: {
  id: string;
  label: string;
  color: string;
  bg: string;
  dot: string;
}[] = [
  { id: "new", label: "New", color: "text-primary", bg: "bg-primary/5", dot: "bg-primary" },
  { id: "contacted", label: "Contacted", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/5", dot: "bg-amber-500" },
  { id: "qualified", label: "Qualified", color: "text-accent-foreground", bg: "bg-accent/5", dot: "bg-accent" },
  { id: "proposal_sent", label: "Proposal Sent", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/5", dot: "bg-violet-500" },
  { id: "negotiation", label: "Negotiation", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/5", dot: "bg-orange-500" },
  { id: "won", label: "Won", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/5", dot: "bg-emerald-500" },
  { id: "lost", label: "Lost", color: "text-destructive", bg: "bg-destructive/5", dot: "bg-destructive" },
];

interface PipelineBoardProps {
  businessId: string;
  onLeadClick?: (lead: Lead) => void;
}

// Re-export Lead type for consumers
export type { Lead as PipelineLead };

export function PipelineBoard({ businessId, onLeadClick }: PipelineBoardProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  async function fetchLeads() {
    try {
      const r = await fetch("/api/leads?status=", { cache: "no-store" });
      const d = await r.json();
      setLeads(d.leads || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLeads();
  }, [businessId]);

  async function updateStatus(leadId: string, newStatus: string) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    );
    try {
      const r = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error);
      }
      toast.success("Lead moved to " + newStatus);
    } catch (e: any) {
      toast.error(e.message);
      fetchLeads(); // revert
    }
  }

  function handleDragStart(e: React.DragEvent, leadId: string) {
    setDraggedId(leadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colId);
  }

  function handleDrop(e: React.DragEvent, colId: string) {
    e.preventDefault();
    if (draggedId) {
      updateStatus(draggedId, colId);
    }
    setDraggedId(null);
    setDragOverCol(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto scroll-thin pb-4">
      <div className="flex gap-4 min-w-max">
        {COLUMNS.map((col) => {
          const colLeads = leads.filter((l) => l.status === col.id);
          const isDragOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              className={cn(
                "w-72 shrink-0 rounded-xl border bg-card/50 transition-colors",
                isDragOver && "border-primary ring-2 ring-primary/20"
              )}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* Column header */}
              <div className={cn("flex items-center justify-between px-3 py-2.5 border-b rounded-t-xl", col.bg)}>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", col.dot)} />
                  <span className={cn("text-sm font-semibold", col.color)}>
                    {col.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {colLeads.length}
                  </span>
                </div>
                {(() => {
                  const total = colLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
                  return total > 0 ? (
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      ${total.toLocaleString()}
                    </span>
                  ) : null;
                })()}
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 min-h-[200px] max-h-[60vh] overflow-y-auto scroll-thin">
                {colLeads.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    Drop leads here
                  </div>
                )}
                {colLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lead.id)}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverCol(null);
                    }}
                    onClick={() => onLeadClick?.(lead as any)}
                    className={cn(
                      "group rounded-lg border bg-background p-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all",
                      draggedId === lead.id && "opacity-50"
                    )}
                  >
                    {/* Drag handle + name */}
                    <div className="flex items-start gap-2">
                      <GripVertical
                        size={14}
                        className="text-muted-foreground/40 group-hover:text-muted-foreground mt-0.5 shrink-0 cursor-grab active:cursor-grabbing"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{lead.name}</div>
                        {lead.service && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {lead.service}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quality badge + deal value */}
                    <div className="flex items-center gap-1.5 mt-2 ml-5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] h-4 px-1.5",
                          lead.quality === "high"
                            ? "border-destructive/30 text-destructive"
                            : lead.quality === "medium"
                            ? "border-accent text-accent-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {lead.quality}
                      </Badge>
                      {lead.dealValue && lead.dealValue > 0 && (
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto tabular-nums">
                          ${lead.dealValue.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Contact icons */}
                    {(lead.email || lead.phone) && (
                      <div className="flex items-center gap-2 mt-2 ml-5 text-xs text-muted-foreground">
                        {lead.email && (
                          <span className="flex items-center gap-0.5">
                            <Mail size={11} />
                          </span>
                        )}
                        {lead.phone && (
                          <span className="flex items-center gap-0.5">
                            <Phone size={11} />
                          </span>
                        )}
                        <span className="flex items-center gap-0.5 ml-auto">
                          <Clock size={11} />
                          {timeAgo(lead.createdAt)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
