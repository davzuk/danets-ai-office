"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").then((r) => console.log("[PWA] SW registered:", r.scope)).catch((e) => console.warn("[PWA] SW failed:", e));
  }, []);
  return null;
}
