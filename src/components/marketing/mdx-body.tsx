import ReactMarkdown from "react-markdown";

/**
 * Renders the markdown body of a CMS post. We use plain markdown (not
 * MDX) on the public site because the security boundary is much
 * narrower — markdown renders only a small set of safe tags through
 * react-markdown, and we explicitly disable raw HTML so a typo in the
 * editor can't inject a `<script>` tag. Styles are inlined as Tailwind
 * classes via the `components` map (no Typography plugin needed).
 */
export function MdxBody({ source }: { source: string }) {
  if (!source || !source.trim()) return null;
  return (
    <div className="space-y-5 text-base leading-relaxed">
      <ReactMarkdown
        components={{
          h1: (props) => (
            <h1
              className="text-3xl font-bold tracking-tight mt-10 mb-4"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="text-2xl font-bold tracking-tight mt-10 mb-3"
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="text-xl font-semibold tracking-tight mt-8 mb-2"
              {...props}
            />
          ),
          p: (props) => <p className="text-muted-foreground" {...props} />,
          ul: (props) => (
            <ul
              className="list-disc list-outside pl-6 text-muted-foreground space-y-1.5"
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              className="list-decimal list-outside pl-6 text-muted-foreground space-y-1.5"
              {...props}
            />
          ),
          li: (props) => <li {...props} />,
          a: ({ node, ...props }) => (
            <a
              {...props}
              className="text-primary hover:underline"
              target={props.href?.startsWith("http") ? "_blank" : undefined}
              rel={
                props.href?.startsWith("http")
                  ? "noopener noreferrer"
                  : undefined
              }
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="border-l-4 border-primary/40 pl-4 italic text-muted-foreground"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="rounded-lg bg-muted p-4 overflow-x-auto text-sm font-mono"
              {...props}
            />
          ),
          hr: (props) => <hr className="my-8 border-border" {...props} />,
          img: ({ node, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="rounded-lg my-6 max-w-full h-auto"
              {...props}
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}