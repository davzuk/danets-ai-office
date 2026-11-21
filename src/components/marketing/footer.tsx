import Link from "next/link";
import {
  ShieldCheck,
  Github,
  Twitter,
  Linkedin,
  Facebook,
  Instagram,
  Youtube,
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { CmsNavItem } from "@/lib/cms";

/**
 * Mapping from CMS-defined social platform names to icons. Anything
 * outside this allow-list falls back to a generic globe icon — the
 * editor can add new platforms without a code change but unknown
 * labels never break the layout.
 */
const SOCIAL_ICONS: Record<string, LucideIcon> = {
  github: Github,
  twitter: Twitter,
  x: Twitter,
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Globe,
  mastodon: Globe,
};

/**
 * Marketing site footer. Renders a 4-column grid:
 *   1. Brand block + tagline + social icons
 *   2. Product links (top-level nav with no children)
 *   3. Resources (Blog, Docs, Changelog)
 *   4. Legal + support email
 */
export function MarketingFooter({
  brand,
  nav,
  tagline,
  supportEmail,
  socialLinks,
}: {
  brand: string;
  nav: CmsNavItem[];
  tagline: string | null;
  supportEmail: string | null;
  socialLinks?: Record<string, string> | null;
}) {
  const product = nav.filter((n) => !n.parentId);
  const year = new Date().getFullYear();

  // Normalise socialLinks into a renderable array of {label, href}
  // pairs. We trust the CMS editor for ordering (object key order).
  const socials = socialLinks
    ? Object.entries(socialLinks)
        .filter(([, href]) => typeof href === "string" && href.length > 0)
        .map(([platform, href]) => ({ platform, href }))
    : [];

  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded-lg brand-gradient flex items-center justify-center text-white">
                <ShieldCheck size={16} strokeWidth={2.5} />
              </span>
              <span className="text-base font-bold tracking-tight">
                Danets<span className="text-primary"> AI</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              {tagline ?? "AI-powered website chat, lead capture, and proposals."}
            </p>
            {supportEmail ? (
              <a
                href={`mailto:${supportEmail}`}
                className="text-sm text-primary hover:underline inline-block"
              >
                {supportEmail}
              </a>
            ) : null}
            {socials.length > 0 ? (
              <ul className="flex items-center gap-2 pt-2">
                {socials.map(({ platform, href }) => {
                  const Icon = SOCIAL_ICONS[platform.toLowerCase()] ?? Globe;
                  return (
                    <li key={platform}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={platform}
                        className="h-8 w-8 rounded-lg border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                      >
                        <Icon size={15} aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="md:col-span-1">
            <FooterColumn title="Product">
              {product.map((item) => (
                <FooterLink key={item.id} href={item.href} label={item.label} />
              ))}
            </FooterColumn>
          </div>

          <div className="md:col-span-1">
            <FooterColumn title="Resources">
              <FooterLink href="/blog" label="Blog" />
              <FooterLink href="/docs" label="Documentation" />
              <FooterLink href="/changelog" label="Changelog" />
              <FooterLink href="/widget-demo" label="Widget demo" />
            </FooterColumn>
          </div>

          <div className="md:col-span-1">
            <FooterColumn title="Company">
              <FooterLink href="/about" label="About" />
              <FooterLink href="/contact" label="Contact" />
              <FooterLink href="/legal/terms" label="Terms" />
              <FooterLink href="/legal/privacy" label="Privacy" />
              <FooterLink href="/legal/cookies" label="Cookies" />
            </FooterColumn>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>
            © {year} Danets TecPro Limited. All rights reserved. Built for
            businesses that want to move faster.
          </p>
          <p className="font-mono">
            <Link href="/" className="hover:text-foreground">
              danets-ai.com
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h4>
      <ul className="space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  const isExternal = href.startsWith("http");
  return (
    <li>
      {isExternal ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {label}
        </a>
      ) : (
        <Link
          href={href}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {label}
        </Link>
      )}
    </li>
  );
}
