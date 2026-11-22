"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { ErrorBoundary } from "@/components/error-boundary";

export default function SignupPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          window.location.href = data.user.isSuperAdmin ? "/platform" : "/app";
        }
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
          initialMode="register"
          onAuthed={(u) => {
            window.location.href = u.isSuperAdmin ? "/platform" : "/app";
          }}
        />
      </div>
    </ErrorBoundary>
  );
}
