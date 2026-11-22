"use client";

// The website editor's live preview. The dashboard frames this page (same
// origin) at desktop or phone width and posts the draft to it; nothing is
// fetched here, so it needs no session and shows only what the editor sent.

import { useEffect, useState } from "react";
import { SiteBlocks, SiteFrame, type SiteNavLink, type SiteRenderContext } from "@/components/sites/site-blocks";
import { validateBlocks, type SiteBlock, type SiteTheme } from "@/lib/sites/blocks";

export interface PreviewMessage {
  type: "danets-site-preview";
  name: string;
  theme: SiteTheme | null;
  nav: SiteNavLink[];
  blocks: SiteBlock[];
  ctx: SiteRenderContext;
  focusBlockId?: string | null;
}

export default function SitePreviewPage() {
  const [msg, setMsg] = useState<PreviewMessage | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as PreviewMessage | null;
      if (d?.type !== "danets-site-preview") return;
      setMsg(d);
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "danets-site-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!msg?.focusBlockId) return;
    document.getElementById(`block-${msg.focusBlockId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [msg?.focusBlockId]);

  if (!msg) return <p className="p-6 text-sm text-gray-500">Loading preview…</p>;
  const { blocks, issues } = validateBlocks(msg.blocks);
  const bad = new Set(issues.map((i) => i.blockId));

  return (
    <SiteFrame name={msg.name} theme={msg.theme} nav={msg.nav}>
      {msg.blocks.length === 0 && <p className="p-10 text-center text-gray-500">Add a block to start building this page.</p>}
      {msg.blocks.map((b) => (
        <div key={b.id} id={`block-${b.id}`}>
          {bad.has(b.id) ? (
            <div className="mx-auto my-6 max-w-3xl rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 text-sm text-amber-800">
              This block needs attention before it can be published: {issues.find((i) => i.blockId === b.id)?.messages.join("; ")}
            </div>
          ) : (
            <SiteBlocks blocks={blocks.filter((x) => x.id === b.id)} ctx={msg.ctx} />
          )}
        </div>
      ))}
    </SiteFrame>
  );
}
