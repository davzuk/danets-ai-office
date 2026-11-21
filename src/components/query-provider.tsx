"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * App-wide react-query provider. Defaults are tuned for a SaaS dashboard:
 *
 * - staleTime 30s — list endpoints don't need to revalidate constantly, but
 *   they should refetch often enough that a stale tab gets fresh data on
 *   focus.
 * - gcTime 5 min — keep recently-used query data so navigation between
 *   tabs feels instant.
 * - retry 1 — fail fast; the UI already has manual refresh buttons.
 * - refetchOnWindowFocus — keep list views fresh when the operator comes
 *   back to the tab.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}