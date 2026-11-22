// Website blocks as plain React (no hooks, no client state), so the same
// components render public pages on the server and the editor's live
// preview in the browser. Colours come from CSS variables set by
// <SiteFrame>: --site-primary, --site-on-primary, --site-accent.

import type { ReactNode } from "react";
import {
  Award, Briefcase, Calendar, Check, Clock, Heart, Home, Leaf, Mail, MapPin, MessageCircle, MessageSquare, Phone, Shield,
  Smile, Sparkles, Star, ThumbsUp, Truck, Users, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { SITE_FONTS, isSafeHref, parseVideoUrl, readableOn, type ParsedBlock, type SiteTheme, DEFAULT_THEME } from "@/lib/sites/blocks";

export interface SiteRenderContext {
  /** The tenant's widget/public key, for booking links. */
  publicKey: string;
  /** Where the hosted booking pages live (the app origin). */
  appOrigin: string;
}

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles, check: Check, star: Star, shield: Shield, clock: Clock, zap: Zap, heart: Heart, users: Users,
  phone: Phone, "map-pin": MapPin, wrench: Wrench, truck: Truck, leaf: Leaf, award: Award, smile: Smile,
  "thumbs-up": ThumbsUp, home: Home, briefcase: Briefcase, calendar: Calendar, message: MessageSquare,
};

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function linkProps(href: string) {
  const external = /^https?:\/\//i.test(href);
  return external ? { href, target: "_blank", rel: "noopener noreferrer" } : { href };
}

function Button({ label, href, variant = "primary" }: { label: string; href: string; variant?: "primary" | "outline" | "light" }) {
  if (!label || !href || !isSafeHref(href)) return null;
  const cls =
    variant === "primary"
      ? "bg-[var(--site-primary)] text-[var(--site-on-primary)] hover:opacity-90"
      : variant === "light"
        ? "bg-white text-gray-900 hover:bg-gray-100"
        : "border border-current hover:bg-black/5";
  return (
    <a {...linkProps(href)} className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition ${cls}`}>
      {label}
    </a>
  );
}

function SectionTitle({ eyebrow, title, subtitle, center = true }: { eyebrow?: string; title?: string; subtitle?: string; center?: boolean }) {
  if (!eyebrow && !title && !subtitle) return null;
  return (
    <div className={`mb-10 max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--site-primary)]">{eyebrow}</p>}
      {title && <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>}
      {subtitle && <p className="mt-3 text-lg text-gray-600">{subtitle}</p>}
    </div>
  );
}

const Section = ({ children, muted = false, id }: { children: ReactNode; muted?: boolean; id?: string }) => (
  <section id={id} className={`px-4 py-16 sm:px-6 sm:py-20 ${muted ? "bg-gray-50" : ""}`}>
    <div className="mx-auto max-w-6xl">{children}</div>
  </section>
);

/** **bold** and [text](link) inside plain paragraphs. Unsafe links render as text. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={k++}>{m[1]}</strong>);
    else if (isSafeHref(m[3]))
      nodes.push(
        <a key={k++} {...linkProps(m[3])} className="text-[var(--site-primary)] underline underline-offset-2">
          {m[2]}
        </a>
      );
    else nodes.push(m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

function Block({ block, ctx }: { block: ParsedBlock; ctx: SiteRenderContext }) {
  const p = block.props;
  switch (block.blockKey) {
    case "hero": {
      const image = s(p.imageUrl);
      const left = p.align === "left";
      return (
        <section className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,var(--site-primary-soft),transparent_45%),radial-gradient(circle_at_85%_30%,var(--site-accent-soft),transparent_40%)]" aria-hidden />
          <div className={`relative mx-auto grid max-w-6xl items-center gap-10 ${left && image ? "lg:grid-cols-2" : ""}`}>
            <div className={left ? "" : "mx-auto max-w-3xl text-center"}>
              {s(p.eyebrow) && <p className="mb-4 inline-block rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--site-primary)]">{s(p.eyebrow)}</p>}
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">{s(p.title)}</h1>
              {s(p.subtitle) && <p className="mt-5 text-lg text-gray-600 sm:text-xl">{s(p.subtitle)}</p>}
              <div className={`mt-8 flex flex-wrap gap-3 ${left ? "" : "justify-center"}`}>
                <Button label={s(p.primaryCtaLabel)} href={s(p.primaryCtaHref)} />
                <Button label={s(p.secondaryCtaLabel)} href={s(p.secondaryCtaHref)} variant="outline" />
              </div>
            </div>
            {image && (
              <img src={image} alt="" className={`w-full rounded-2xl object-cover shadow-xl ${left ? "" : "mx-auto mt-4 max-w-4xl"}`} />
            )}
          </div>
        </section>
      );
    }
    case "feature-grid": {
      const items = list<{ icon?: string; title: string; description: string }>(p.items);
      return (
        <Section>
          <SectionTitle eyebrow={s(p.eyebrow)} title={s(p.title)} subtitle={s(p.subtitle)} />
          <div className={`grid gap-6 ${COLS[Number(p.columns) || 3] ?? COLS[3]}`}>
            {items.map((f, i) => {
              const Icon = ICONS[f.icon ?? ""] ?? Sparkles;
              return (
                <div key={i} className="rounded-2xl border bg-white p-6 shadow-sm">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--site-primary)] text-[var(--site-on-primary)]">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-gray-600">{f.description}</p>
                </div>
              );
            })}
          </div>
        </Section>
      );
    }
    case "testimonials": {
      const items = list<{ quote: string; author: string; role?: string }>(p.items);
      return (
        <Section muted>
          <SectionTitle title={s(p.title)} />
          <div className={`grid gap-6 ${items.length > 1 ? "md:grid-cols-2 lg:grid-cols-3" : "mx-auto max-w-2xl"}`}>
            {items.map((t, i) => (
              <figure key={i} className="rounded-2xl border bg-white p-6 shadow-sm">
                <blockquote className="text-gray-700">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-sm">
                  <span className="font-semibold">{t.author}</span>
                  {t.role && <span className="text-gray-500"> · {t.role}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      );
    }
    case "faq": {
      const items = list<{ question: string; answer: string }>(p.items);
      return (
        <Section>
          <SectionTitle title={s(p.title)} />
          <div className="mx-auto max-w-3xl divide-y rounded-2xl border bg-white">
            {items.map((q, i) => (
              <details key={i} className="group p-5">
                <summary className="cursor-pointer list-none font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {q.question}
                    <span className="text-[var(--site-primary)] transition group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 whitespace-pre-line text-gray-600">{q.answer}</p>
              </details>
            ))}
          </div>
        </Section>
      );
    }
    case "cta":
      return (
        <section className="px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-5xl rounded-3xl bg-[var(--site-primary)] px-6 py-14 text-center text-[var(--site-on-primary)] sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{s(p.title)}</h2>
            {s(p.subtitle) && <p className="mx-auto mt-3 max-w-2xl text-lg opacity-90">{s(p.subtitle)}</p>}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button label={s(p.primaryCtaLabel)} href={s(p.primaryCtaHref)} variant="light" />
              <Button label={s(p.secondaryCtaLabel)} href={s(p.secondaryCtaHref)} variant="outline" />
            </div>
          </div>
        </section>
      );
    case "rich-text": {
      const paras = s(p.body)
        .split(/\n\s*\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      return (
        <Section>
          <div className={`mx-auto max-w-3xl ${p.align === "center" ? "text-center" : ""}`}>
            {s(p.title) && <h2 className="mb-6 text-3xl font-bold tracking-tight">{s(p.title)}</h2>}
            <div className="space-y-4 text-lg leading-relaxed text-gray-700">
              {paras.map((para, i) => (
                <p key={i} className="whitespace-pre-line">
                  {renderInline(para)}
                </p>
              ))}
            </div>
          </div>
        </Section>
      );
    }
    case "stats": {
      const items = list<{ value: string; label: string }>(p.items);
      return (
        <Section muted>
          <SectionTitle title={s(p.title)} />
          <dl className={`grid gap-6 text-center ${items.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {items.map((x, i) => (
              <div key={i}>
                <dt className="sr-only">{x.label}</dt>
                <dd className="text-4xl font-extrabold text-[var(--site-primary)]">{x.value}</dd>
                <dd className="mt-1 text-gray-600">{x.label}</dd>
              </div>
            ))}
          </dl>
        </Section>
      );
    }
    case "logo-cloud": {
      const logos = list<{ name: string; imageUrl?: string; href?: string }>(p.logos);
      return (
        <Section>
          <SectionTitle title={s(p.title)} />
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {logos.map((l, i) => {
              const inner = l.imageUrl ? (
                <img src={l.imageUrl} alt={l.name} className="h-10 w-auto max-w-[160px] object-contain opacity-80" />
              ) : (
                <span className="text-lg font-semibold text-gray-500">{l.name}</span>
              );
              return <li key={i}>{l.href && isSafeHref(l.href) ? <a {...linkProps(l.href)}>{inner}</a> : inner}</li>;
            })}
          </ul>
        </Section>
      );
    }
    case "contact-details": {
      const phone = s(p.phone);
      const wa = s(p.whatsapp).replace(/[^0-9]/g, "");
      const email = s(p.email);
      const rows: { icon: LucideIcon; label: string; node: ReactNode }[] = [];
      if (s(p.address)) rows.push({ icon: MapPin, label: "Address", node: <span className="whitespace-pre-line">{s(p.address)}</span> });
      if (phone) rows.push({ icon: Phone, label: "Phone", node: <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>{phone}</a> });
      if (email) rows.push({ icon: Mail, label: "Email", node: <a href={`mailto:${email}`}>{email}</a> });
      if (wa) rows.push({ icon: MessageCircle, label: "WhatsApp", node: <a {...linkProps(`https://wa.me/${wa}`)}>{s(p.whatsapp)}</a> });
      if (s(p.hours)) rows.push({ icon: Clock, label: "Opening hours", node: <span className="whitespace-pre-line">{s(p.hours)}</span> });
      return (
        <Section muted id="contact">
          <SectionTitle title={s(p.title)} />
          <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-3 rounded-2xl border bg-white p-5">
                <r.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--site-primary)]" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-gray-500">{r.label}</p>
                  <div className="mt-1 text-gray-900 [&_a]:underline [&_a]:underline-offset-2">{r.node}</div>
                </div>
              </div>
            ))}
          </div>
          {s(p.mapUrl) && isSafeHref(s(p.mapUrl)) && (
            <p className="mt-6 text-center">
              <Button label="Get directions" href={s(p.mapUrl)} variant="outline" />
            </p>
          )}
        </Section>
      );
    }
    case "gallery": {
      const images = list<{ url: string; alt?: string; caption?: string }>(p.images);
      return (
        <Section>
          <SectionTitle title={s(p.title)} />
          <div className={`grid gap-4 ${COLS[Number(p.columns) || 3] ?? COLS[3]}`}>
            {images.map((img, i) => (
              <figure key={i} className="overflow-hidden rounded-2xl border bg-white">
                <img src={img.url} alt={img.alt ?? ""} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                {img.caption && <figcaption className="p-3 text-sm text-gray-600">{img.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </Section>
      );
    }
    case "video": {
      const v = parseVideoUrl(s(p.url));
      if (!v) return null;
      return (
        <Section>
          <SectionTitle title={s(p.title)} />
          <div className="mx-auto max-w-4xl">
            <div className="aspect-video overflow-hidden rounded-2xl border bg-black">
              <iframe
                src={v.embedUrl}
                title={s(p.title) || "Video"}
                className="h-full w-full"
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              />
            </div>
            {s(p.caption) && <p className="mt-3 text-center text-sm text-gray-600">{s(p.caption)}</p>}
          </div>
        </Section>
      );
    }
    case "booking": {
      const slug = s(p.bookingTypeSlug);
      const href = `${ctx.appOrigin}/book/${encodeURIComponent(ctx.publicKey)}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
      return (
        <Section muted id="book">
          <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-10 text-center shadow-sm">
            <Calendar className="mx-auto h-10 w-10 text-[var(--site-primary)]" aria-hidden />
            {s(p.title) && <h2 className="mt-4 text-3xl font-bold tracking-tight">{s(p.title)}</h2>}
            {s(p.subtitle) && <p className="mt-3 text-lg text-gray-600">{s(p.subtitle)}</p>}
            <div className="mt-6">
              <Button label={s(p.buttonLabel) || "Book a time"} href={href} />
            </div>
          </div>
        </Section>
      );
    }
  }
}

export function SiteBlocks({ blocks, ctx }: { blocks: ParsedBlock[]; ctx: SiteRenderContext }) {
  return (
    <>
      {blocks.map((b) => (
        <Block key={b.id} block={b} ctx={ctx} />
      ))}
    </>
  );
}

/** Theme CSS variables for a site. */
export function themeStyle(theme: SiteTheme | null | undefined): Record<string, string> {
  const primary = theme?.primaryColor ?? DEFAULT_THEME.primaryColor;
  const accent = theme?.accentColor ?? DEFAULT_THEME.accentColor;
  const font = SITE_FONTS[theme?.font ?? DEFAULT_THEME.font] ?? SITE_FONTS.system;
  return {
    "--site-primary": primary,
    "--site-on-primary": readableOn(primary),
    "--site-accent": accent,
    "--site-primary-soft": `${primary}26`,
    "--site-accent-soft": `${accent}22`,
    fontFamily: font.stack,
  };
}

export interface SiteNavLink {
  label: string;
  href: string;
}

/** Header, page body and footer, themed. */
export function SiteFrame({
  name,
  theme,
  nav,
  footerNote,
  children,
}: {
  name: string;
  theme: SiteTheme | null | undefined;
  nav: SiteNavLink[];
  footerNote?: string;
  children: ReactNode;
}) {
  return (
    <div style={themeStyle(theme) as React.CSSProperties} className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-bold">
            {theme?.logoUrl ? (
              <img src={theme.logoUrl} alt={name} className="h-9 w-auto max-w-[180px] object-contain" />
            ) : (
              <span className="text-lg">{name}</span>
            )}
          </a>
          {nav.length > 0 && (
            <nav aria-label="Main">
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-gray-600">
                {nav.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="hover:text-[var(--site-primary)]">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 sm:px-6">
        <p>
          © {new Date().getFullYear()} {name}
        </p>
        {footerNote && <p className="mt-1">{footerNote}</p>}
      </footer>
    </div>
  );
}
