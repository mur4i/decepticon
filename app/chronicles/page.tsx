import Link from "next/link";
import { getChronicles } from "@/lib/chronicles";
import { getMission } from "@/lib/mission";
import GlassCard from "@/components/GlassCard";

export default function ChroniclesIndex() {
  const items = getChronicles();
  const mission = getMission();

  return (
    <main className="min-h-screen px-6 py-24 max-w-4xl mx-auto">
      <header className="mb-16">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Corpus</p>
        <h1 className="text-4xl md:text-5xl font-extralight mt-2">Chronicles</h1>
        <p className="mt-4 text-white/50 font-light leading-relaxed max-w-2xl">
          {mission.statement}
        </p>
      </header>

      {items.length === 0 ? (
        <GlassCard>
          <p className="text-white/40 font-light">
            The corpus is empty. The first chronicle has not been written yet.
          </p>
        </GlassCard>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/chronicles/${c.slug}/`} className="block">
                <GlassCard className="hover:bg-white/[0.06] transition">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                        {c.id} · {c.axes.join(" · ")}
                      </p>
                      <h2 className="mt-2 text-xl font-light truncate">{c.title}</h2>
                    </div>
                    <p className="text-xs text-white/40 tabular-nums whitespace-nowrap">
                      {new Date(c.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </GlassCard>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
