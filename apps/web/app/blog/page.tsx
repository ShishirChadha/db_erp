import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedBlogPosts } from "@/lib/queries";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Blog",
  description: "Buying guides and news from DigitalBluez.",
  alternates: { canonical: "/blog" },
};

export default async function BlogPage() {
  const posts = await getPublishedBlogPosts();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Blog</h1>
      <p className="mt-1 text-sm text-muted-foreground">Buying guides, warranty tips and news from DigitalBluez.</p>

      {posts.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Coming soon — check back for buying guides and updates.
        </p>
      ) : (
        <div className="stagger mt-8 space-y-6">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="block rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-orange/30 hover:shadow-md"
            >
              <p className="font-heading text-lg font-bold text-foreground">{post.title}</p>
              {post.excerpt && <p className="mt-1.5 text-sm text-muted-foreground">{post.excerpt}</p>}
              {post.published_at && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {new Date(post.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
