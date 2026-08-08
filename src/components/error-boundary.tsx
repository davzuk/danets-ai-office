"use client";

import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Use the structured logger so the error lands in the same pipeline as
    // server-side logs (request ID correlation, JSON serialization, alerts).
    // The logger module is dynamic-imported because it's server-only — in the
    // browser we fall back to console.error if the import fails.
    import("@/lib/logger/client")
      .then(({ logger }) =>
        logger.error("ErrorBoundary caught", {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
        })
      )
      .catch(() => {
        console.error("[ErrorBoundary]", error, errorInfo);
      });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
          <div className="max-w-md w-full rounded-2xl border bg-card p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <AlertTriangle size={28} className="text-destructive" />
            </div>
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-sm text-muted-foreground mb-6">
              An unexpected error occurred. Try refreshing the page — your data is safe.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs text-muted-foreground bg-muted rounded-lg p-3 mb-4 overflow-auto max-h-32 scroll-thin">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="gap-2"
              >
                <RefreshCw size={16} />
                Refresh Page
              </Button>
              <Button onClick={() => window.location.href = "/"}>
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
