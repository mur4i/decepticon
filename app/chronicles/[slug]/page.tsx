import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { getChronicles, getChronicleBySlug } from "@/lib/chronicles";
import EdgeTtsReader from "@/components/EdgeTtsReader";

export const dynamicParams = false;

export function generateStaticParams() {
  return getChronicles().map((c) => ({ slug: c.slug }));
}

export default async function Chronicle({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = getChronicleBySlug(slug);
  if (!data) notFound();
  const html = marked.parse(data.body, { async: false }) as string;

  return (
    <main className="min-h-screen px-6 py-24 max-w-3xl mx-auto">
      <Link
        href="/chronicles/"
        className="text-xs uppercase tracking-[0.3em] text-white/40 hover:text-white/70 transition"
      >
        ← Corpus
      </Link>

      <header className="mt-10 mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
          {data.entry.id} · {data.entry.axes.join(" · ")}
        </p>
        <h1 className="text-4xl md:text-5xl font-extralight mt-3 leading-tight">
          {data.entry.title}
        </h1>
        <p className="mt-4 text-xs text-white/40 tabular-nums">
          {new Date(data.entry.publishedAt).toUTCString()}
        </p>
      </header>

      <div className="mb-12">
        <EdgeTtsReader targetSelector=".chronicle-body" />
      </div>

      <article
        className="chronicle-body prose prose-invert prose-neutral max-w-none font-light prose-headings:font-extralight prose-headings:tracking-tight prose-p:text-white/70 prose-p:leading-relaxed prose-a:text-white/90 prose-strong:text-white prose-strong:font-normal"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {data.entry.references && data.entry.references.length > 0 && (
        <footer className="mt-16 pt-8 border-t border-white/10">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-4">
            References
          </p>
          <ul className="space-y-1 text-white/50 font-light text-sm">
            {data.entry.references.map((r, i) => (
              <li key={i}>— {r}</li>
            ))}
          </ul>
        </footer>
      )}
    </main>
  );
}
