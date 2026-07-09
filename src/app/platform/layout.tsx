import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Platform Console — Danets AI",
  description:
    "Danets TecPro internal platform administration — tenants, subscriptions, billing, and feature control.",
};

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
