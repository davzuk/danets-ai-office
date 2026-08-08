"use client";

import { Component, ReactNode } from "react";
import type { CmsPageBlock } from "@/lib/cms";
import { HeroBlock } from "@/components/marketing/blocks/hero";
import { FeatureGridBlock } from "@/components/marketing/blocks/feature-grid";
import { LogoCloudBlock } from "@/components/marketing/blocks/logo-cloud";
import { TestimonialsBlock } from "@/components/marketing/blocks/testimonials";
import { PricingTableBlock } from "@/components/marketing/blocks/pricing-table";
import { FaqBlock } from "@/components/marketing/blocks/faq";
import { CtaBlock } from "@/components/marketing/blocks/cta";
import { RichTextBlock } from "@/components/marketing/blocks/rich-text";
import { StatsBlock } from "@/components/marketing/blocks/stats";
import { UnknownBlock } from "@/components/marketing/blocks/unknown";
import { validateBlockProps } from "@/components/marketing/block-schemas";

/**
 * Renders an ordered list of CMS blocks. Unknown block keys render an
 * inline `<UnknownBlock>` placeholder so a typo in the CMS never blanks
 * a page — the editor sees a clear "this block isn't wired up yet"
 * panel instead of a missing section.
 *
 * Each block runs inside its own error boundary so a malformed prop in
 * one section (e.g. an icon name that doesn't resolve) won't blank the
 * whole marketing page — the surrounding blocks still render and the
 * broken one shows a small placeholder instead.
 */
export function BlockRenderer({ blocks }: { blocks: CmsPageBlock[] }) {
  return (
    <>
      {blocks.map((block, idx) => (
        <BlockErrorBoundary key={`${block.blockKey}-${idx}`} index={block}>
          <BlockSlot block={block} index={idx} />
        </BlockErrorBoundary>
      ))}
    </>
  );
}

function BlockSlot({ block, index }: { block: CmsPageBlock; index: number }) {
  // Validate the raw CMS props against the per-block Zod schema. If
  // validation fails we surface the issues to the editor via the
  // unknown-block placeholder rather than rendering a half-broken
  // section (e.g. an <h1></h1> with the title missing).
  const validation = validateBlockProps(block.blockKey, block.props);
  if (!validation.ok) {
    return (
      <UnknownBlock
        key={index}
        blockKey={block.blockKey}
        issues={validation.issues}
      />
    );
  }
  const props = validation.props;
  switch (block.blockKey) {
    case "hero":
      return <HeroBlock key={index} {...(props as any)} />;
    case "feature-grid":
      return <FeatureGridBlock key={index} {...(props as any)} />;
    case "logo-cloud":
      return <LogoCloudBlock key={index} {...(props as any)} />;
    case "testimonials":
      return <TestimonialsBlock key={index} {...(props as any)} />;
    case "pricing-table":
      return <PricingTableBlock key={index} {...(props as any)} />;
    case "faq":
      return <FaqBlock key={index} {...(props as any)} />;
    case "cta":
      return <CtaBlock key={index} {...(props as any)} />;
    case "rich-text":
      return <RichTextBlock key={index} {...(props as any)} />;
    case "stats":
      return <StatsBlock key={index} {...(props as any)} />;
    default:
      return <UnknownBlock key={index} blockKey={block.blockKey} />;
  }
}

/**
 * Per-block error boundary. A throw inside one block (e.g. an icon name
 * that didn't resolve, a malformed CMS prop) only blanks that section —
 * the rest of the page keeps rendering.
 */
class BlockErrorBoundary extends Component<
  { children: ReactNode; index: CmsPageBlock },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") {
      console.warn(
        `[BlockRenderer] block "${this.props.index.blockKey}" failed to render`,
        error.message
      );
    }
  }
  render() {
    if (this.state.hasError) {
      // Inline placeholder so the layout doesn't shift; the editor
      // can see which block broke at a glance.
      return (
        <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          This section failed to render. Check the CMS block configuration.
        </div>
      );
    }
    return this.props.children;
  }
}