import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { checkQuota, LimitExceededError } from "@/lib/plan-quota";

// POST /api/knowledge-base/import
// Bulk import knowledge base items from pasted text.
// Supported formats:
//   - "Title: content" per line (colon-separated)
//   - Double-newline separated blocks (first line = title, rest = content)
//   - JSON array of { title, content, category? }
const schema = z.object({
  format: z.enum(["auto", "colon", "blocks", "json"]).default("auto"),
  category: z.string().max(60).optional(),
  text: z.string().min(1).max(50000),
});

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const { format, category, text } = parsed.data;
    const items: { title: string; content: string; category: string }[] = [];

    // Try JSON first if format is json or auto + looks like JSON
    if (format === "json" || (format === "auto" && text.trim().startsWith("["))) {
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) {
          for (const it of arr) {
            if (it && typeof it.title === "string" && typeof it.content === "string") {
              items.push({
                title: it.title.slice(0, 200),
                content: it.content,
                category: it.category || category || "Imported",
              });
            }
          }
        }
      } catch {
        if (format === "json") throw new Error("Invalid JSON array");
      }
    }

    if (items.length === 0 && (format === "blocks" || format === "auto")) {
      // Split on double newlines
      const blocks = text
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean);
      for (const block of blocks) {
        const lines = block.split("\n");
        const title = lines[0].trim().replace(/^#+\s*/, "").slice(0, 200);
        const content = lines.slice(1).join("\n").trim() || title;
        if (title) {
          items.push({ title, content, category: category || "Imported" });
        }
      }
    }

    if (items.length === 0 && (format === "colon" || format === "auto")) {
      // "Title: content" per line
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx > 0 && idx < 120) {
          const title = line.slice(0, idx).trim().slice(0, 200);
          const content = line.slice(idx + 1).trim();
          if (title && content) {
            items.push({ title, content, category: category || "Imported" });
          }
        }
      }
    }

    if (items.length === 0) {
      throw new Error(
        "No items could be parsed. Use 'Title: content' per line, blank-line-separated blocks, or a JSON array."
      );
    }

    // Cap at 50 items per import
    const toCreate = items.slice(0, 50).map((it) => ({
      businessId: user.businessId,
      title: it.title,
      content: it.content,
      category: it.category,
      sourceType: "doc",
      status: "active" as const,
    }));

    const quota = await checkQuota(user.businessId, "kbItems", toCreate.length);
    if (!quota.allowed) {
      throw new LimitExceededError("kbItems", quota.limit, quota.used);
    }

    const result = await db.knowledgeBaseItem.createMany({ data: toCreate });

    return {
      imported: result.count,
      skipped: items.length - result.count,
    };
  });
}
