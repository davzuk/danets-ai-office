"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { ErrorBoundary } from "@/components/error-boundary";

export default function LoginPage() {
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState<{
    appName?: string;
    customLogoUrl?: string | null;
    hideBranding?: boolean;
    primaryColor?: string;
  } | null>(null);
  const router = useRouter();

  // If a session already exists, jump straight to the dashboard.
  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/brand").then((r) => r.json()),
    ])
      .then(([me, b]) => {
        if (me?.user) {
          window.location.href = me.user.isSuperAdmin ? "/platform" : "/app";
        }
        setBrand(b?.brand ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {/* fade-in handled via CSS so we can drop the framer-motion runtime */}
      <div className="animate-fade-in">
        <AuthScreen
          brand={brand}
          onAuthed={(u) => {
            window.location.href = u.isSuperAdmin ? "/platform" : "/app";
          }}
        />
      </div>
    </ErrorBoundary>
  );
}
