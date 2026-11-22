import Link from "next/link";
import type { Metadata } from "next";
import { listPublishedPosts } from "@/lib/cms";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Blog — Danets AI Automation",
  description:
    "Product news, AI insights and engineering posts from the Danets TecPro team.",
};

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BlogIndex() {
  const posts = await listPublishedPosts({ limit: 30 });
  if (posts.length === 0) {
    return (
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight">The blog</h1>
          <p className="text-muted-foreground mt-2">
            Posts will appear here once published from the CMS.
          </p>
        </div>
      </section>
    );
  }
  const [featured, ...rest] = posts;

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <header className="mb-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            Blog
          </div>
          <h1 className="text-4xl font-bold tracking-tight">From the team</h1>
          <p className="text-lg text-muted-foreground mt-2 max-w-2xl">
            Product news, AI insights and engineering posts from Danets
            TecPro.
          </p>
        </header>

        {featured ? (
          <Link
            href={`/blog/${featured.slug}`}
            className="block rounded-2xl border bg-card overflow-hidden card-hover mb-12"
          >
            <div className="grid md:grid-cols-2">
              {featured.coverImage ? (
                <div
                  className="aspect-[16/10] md:aspect-auto bg-muted"
                  style={{
                    backgroundImage: `url(${featured.coverImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div className="aspect-[16/10] md:aspect-auto brand-gradient" />
              )}
              <div className="p-8 flex flex-col justify-center">
                <div className="text-xs text-muted-foreground mb-2">
                  {formatDate(featured.publishedAt)}
                  {featured.author ? ` · ${featured.author.name}` : ""}
                </div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {featured.title}
                </h2>
                {featured.excerpt ? (
                  <p className="text-muted-foreground mt-3 line-clamp-3">
                    {featured.excerpt}
                  </p>
                ) : null}
                <span className="text-primary text-sm font-medium mt-4 inline-block">
                  Read article →
                </span>
              </div>
            </div>
          </Link>
        ) : null}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {rest.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="rounded-xl border bg-card overflow-hidden card-hover flex flex-col"
            >
              {post.coverImage ? (
                <div
                  className="aspect-[16/9] bg-muted"
                  style={{
                    backgroundImage: `url(${post.coverImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div className="aspect-[16/9] bg-muted/40" />
              )}
              <div className="p-5 flex-1 flex flex-col">
                <div className="text-xs text-muted-foreground mb-2">
                  {formatDate(post.publishedAt)}
                </div>
                <h3 className="text-lg font-semibold leading-snug">
                  {post.title}
                </h3>
                {post.excerpt ? (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                    {post.excerpt}
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}