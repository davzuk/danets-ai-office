import "../globals.css";

// Root layout for tenant websites (and the editor's preview). Deliberately
// bare: none of the app's providers, scripts, manifest or service worker,
// so a tenant page carries nothing from the dashboard.
export default function SitesRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
