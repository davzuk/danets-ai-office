type RichTextProps = {
  title?: string;
  body: string;
  align?: "left" | "center";
};

/**
 * Lightweight renderer that turns a paragraph of plain text + blank-line
 * separators into stacked paragraphs. Supports `**bold**` and `[link](url)`
 * for the occasional inline emphasis. Keeps the editor surface small and
 * the output CSP-safe (no `dangerouslySetInnerHTML`).
 */
export function RichTextBlock({
  title,
  body,
  align = "left",
}: RichTextProps) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section className="py-12 sm:py-16">
      <div
        className={`mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 ${
          align === "center" ? "text-center" : ""
        }`}
      >
        {title ? (
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-6">
            {title}
          </h2>
        ) : null}
        <div className="space-y-4 text-base text-muted-foreground leading-relaxed">
          {paragraphs.map((p, i) => (
            <p key={i}>{renderInline(p)}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Render `**bold**` and `[text](url)` segments as React nodes. */
function renderInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/;
  const boldRe = /\*\*([^*]+)\*\*/;

  while (remaining.length > 0) {
    const linkMatch = remaining.match(linkRe);
    const boldMatch = remaining.match(boldRe);

    // Pick whichever comes first
    const candidates = [
      linkMatch ? { idx: linkMatch.index ?? -1, type: "link" as const } : null,
      boldMatch ? { idx: boldMatch.index ?? -1, type: "bold" as const } : null,
    ]
      .filter(Boolean)
      .sort((a, b) => a!.idx - b!.idx);

    const next = candidates[0];
    if (!next || next.idx === -1) {
      nodes.push(remaining);
      break;
    }

    if (next.idx > 0) {
      nodes.push(remaining.slice(0, next.idx));
    }

    if (next.type === "link") {
      const [, label, url] = linkMatch!;
      nodes.push(
        <a
          key={key++}
          href={url}
          className="text-primary hover:underline"
          target={url.startsWith("http") ? "_blank" : undefined}
          rel={url.startsWith("http") ? "noopener noreferrer" : undefined}
        >
          {label}
        </a>
      );
      remaining = remaining.slice(next.idx + linkMatch![0].length);
    } else {
      const [, label] = boldMatch!;
      nodes.push(
        <strong key={key++} className="text-foreground font-semibold">
          {label}
        </strong>
      );
      remaining = remaining.slice(next.idx + boldMatch![0].length);
    }
  }

  return nodes;
}
