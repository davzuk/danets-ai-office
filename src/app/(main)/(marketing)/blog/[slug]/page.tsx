import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  getCmsPostBySlug,
  getCmsPostNeighbors,
  listPublishedPosts,
} from "@/lib/cms";
import { MdxBody } from "@/components/marketing/mdx-body";

export const revalidate = 60;

export async function generateStaticParams() {
  const posts = await listPublishedPosts({ limit: 200 });
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getCmsPostBySlug(slug);
  if (!post) return { title: "Post not found" };
  const seo = post.seo as
    | { title?: string; description?: string }
    | null;
  return {
    title: seo?.title || post.title,
    description: seo?.description || post.excerpt || undefined,
    openGraph: post.coverImage
      ? {
          title: post.title,
          images: [{ url: post.coverImage }],
        }
      : undefined,
  };
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getCmsPostBySlug(slug);
  if (!post) notFound();

  // Prev/next are independent queries — fetching them in parallel with the
  // post itself trims a round trip off the cold render.
  const { prev, next } = await getCmsPostNeighbors(slug);

  return (
    <article className="py-12 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/blog"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> Back to blog
        </Link>

        <header className="mb-10">
          <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
            <span>{formatDate(post.publishedAt)}</span>
            {post.author ? (
              <>
                <span>·</span>
                <span>{post.author.name}</span>
              </>
            ) : null}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            {post.title}
          </h1>
          {post.excerpt ? (
            <p className="text-lg text-muted-foreground mt-4 leading-relaxed">
              {post.excerpt}
            </p>
          ) : null}
        </header>

        {post.coverImage ? (
          <div
            className="aspect-[16/9] rounded-xl bg-muted mb-10"
            style={{
              backgroundImage: `url(${post.coverImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : null}

        <MdxBody source={post.bodyMdx} />

        {post.tags.length > 0 ? (
          <div className="mt-12 pt-6 border-t flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground font-medium">Tags:</span>
            {post.tags.map((t) => (
              <Link
                key={t.id}
                href={`/blog?tag=${encodeURIComponent(t.slug)}`}
                className="rounded-full bg-muted px-2.5 py-1 hover:bg-muted/70"
              >
                {t.name}
              </Link>
            ))}
          </div>
        ) : null}

        {prev || next ? (
          <nav
            aria-label="Post navigation"
            className="mt-12 pt-8 border-t grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {prev ? (
              <Link
                href={`/blog/${prev.slug}`}
                className="group rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors"
              >
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mb-1">
                  <ArrowLeft className="h-3 w-3" /> Newer post
                </div>
                <div className="font-semibold leading-snug group-hover:text-primary line-clamp-2">
                  {prev.title}
                </div>
              </Link>
            ) : (
              <div aria-hidden="true" />
            )}
            {next ? (
              <Link
                href={`/blog/${next.slug}`}
                className="group rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors sm:text-right"
              >
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mb-1 sm:justify-end">
                  Older post <ArrowRight className="h-3 w-3" />
                </div>
                <div className="font-semibold leading-snug group-hover:text-primary line-clamp-2">
                  {next.title}
                </div>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </article>
  );
}