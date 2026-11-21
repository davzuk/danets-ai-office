import { z } from "zod";

// Keywords structured outputs does not accept. Zod still validates them
// client-side after the response comes back.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = sanitize(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** Convert a Zod schema into a JSON schema that structured outputs accepts. */
export function toStructuredJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return sanitize(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

/**
 * Pull the first JSON object/array out of a model reply. Used for providers
 * that cannot enforce a schema server-side (z-ai) and as a guard for others.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to bracket scan (handles ```json fences and prose)
  }
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((i) => i !== -1);
  if (starts.length === 0) throw new SyntaxError("No JSON found in model output");
  const start = Math.min(...starts);
  const close = trimmed[start] === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(close);
  if (end <= start) throw new SyntaxError("Unterminated JSON in model output");
  return JSON.parse(trimmed.slice(start, end + 1));
}
