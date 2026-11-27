// The body of an AI-written lead magnet, as the tenant edits it and the PDF
// renders it. Shared by the server (validation, PDF) and the editor.

import { z } from "zod";

export const magnetSectionSchema = z.object({
  heading: z.string().trim().min(1).max(160),
  paragraph: z.string().trim().max(2000).optional().default(""),
  items: z.array(z.string().trim().min(1).max(400)).max(25).default([]),
});

export const magnetContentSchema = z.object({
  intro: z.string().trim().max(2000).default(""),
  sections: z.array(magnetSectionSchema).min(1).max(15),
  closing: z.string().trim().max(1000).optional().default(""),
});

export type MagnetContent = z.infer<typeof magnetContentSchema>;
export type MagnetSection = z.infer<typeof magnetSectionSchema>;

export const MAGNET_STYLES = ["checklist", "guide"] as const;
export type MagnetStyle = (typeof MAGNET_STYLES)[number];

export function readContent(raw: unknown): MagnetContent | null {
  const r = magnetContentSchema.safeParse(raw);
  return r.success ? r.data : null;
}
