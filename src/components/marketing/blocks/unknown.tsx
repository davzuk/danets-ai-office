import { AlertTriangle } from "lucide-react";

/**
 * Rendered when a CMS page references a blockKey that the renderer
 * doesn't know about OR when known block's props fail runtime Zod
 * validation. Keeps the page from going blank and gives the editor a
 * clear visual cue to fix the configuration.
 */
export function UnknownBlock({
  blockKey,
  issues,
}: {
  blockKey: string;
  /**
   * When set, the renderer hit a known blockKey but its props failed
   * schema validation. We surface the field-level issues instead of
   * the generic "block not registered" message so the editor knows
   * exactly which field is wrong.
   */
  issues?: string[];
}) {
  return (
    <section className="py-8">
      <div className="mx-auto max-w-3xl px-4">
        <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20 p-4 flex items-start gap-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              {issues && issues.length > 0
                ? `Block "${blockKey}" has invalid configuration`
                : "Unknown block"}
            </div>
            {issues && issues.length > 0 ? (
              <div className="text-amber-800 dark:text-amber-300 mt-1 space-y-1">
                <p>The CMS props failed validation:</p>
                <ul className="list-disc list-inside space-y-0.5 font-mono text-xs">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                The CMS page references block{" "}
                <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-xs">
                  {blockKey}
                </code>{" "}
                which is not registered. Check the block key in the editor.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
