import Link from "next/link";
import { ThemeToggle } from "@/components/dashboard/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { getCmsNavItems, getCmsSite } from "@/lib/cms";
import type { CmsNavItem } from "@/lib/cms";
import { MarketingFooter } from "@/components/marketing/footer";

/**
 * Marketing chrome — top nav from the CMS, theme toggle, auth links,
 * footer with brand and legal links. Used by every (marketing) route.
 */
export async function MarketingShell({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname?: string;
}) {
  const [site, nav] = await Promise.all([getCmsSite(), getCmsNavItems()]);
  const brand = site?.brandName ?? "Danets AI Automation";

  // Build a two-level tree (top-level items + dropdowns from children)
  const topLevel = nav.filter((n) => !n.parentId);
  const childrenOf = (id: string) =>
    nav.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="h-9 w-9 rounded-xl brand-gradient flex items-center justify-center text-white shadow-sm">
              <ShieldCheck size={18} strokeWidth={2.5} />
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold tracking-tight">
                Danets<span className="text-primary"> AI</span>
              </span>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-0.5">
                TecPro Automation
              </span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-6 text-sm">
            {topLevel.map((item) => (
              <NavLink key={item.id} item={item} pathname={pathname} children={childrenOf(item.id)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/widget-demo"
              className="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground transition-colors px-2"
            >
              Live demo
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="h-9">
                Sign in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="h-9">
                Get started
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1">{children}</main>

      <MarketingFooter
        brand={brand}
        nav={nav}
        supportEmail={site?.supportEmail ?? null}
        tagline={site?.tagline ?? null}
        socialLinks={site?.socialLinks ?? null}
      />
    </div>
  );
}

function NavLink({
  item,
  pathname,
  children,
}: {
  item: CmsNavItem;
  pathname?: string;
  children: CmsNavItem[];
}) {
  const isExternal = item.href.startsWith("http");
  const isActive =
    pathname !== undefined &&
    (pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(`${item.href}/`)));

  const linkClass = cn(
    "px-3 py-1.5 rounded-md transition-colors",
    isActive
      ? "text-foreground bg-muted"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
  );

  if (children.length === 0) {
    return isExternal ? (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        {item.label}
      </a>
    ) : (
      <Link href={item.href} className={linkClass}>
        {item.label}
      </Link>
    );
  }

  // Dropdown for parents with children
  return (
    <div className="relative group">
      <Link href={item.href} className={linkClass}>
        {item.label}
        <span className="ml-1 text-xs opacity-60">▾</span>
      </Link>
      <div className="absolute left-0 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
        <div className="min-w-[200px] rounded-lg border bg-popover shadow-lg p-1">
          {children.map((child) => (
            <Link
              key={child.id}
              href={child.href}
              className="block px-3 py-2 rounded-md text-sm hover:bg-muted"
            >
              {child.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// Tiny inline cn — avoid pulling util for one conditional.
function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
