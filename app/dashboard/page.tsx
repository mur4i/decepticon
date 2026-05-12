import Link from "next/link";
import { getMetrics } from "@/lib/metrics";
import GlassCard from "@/components/GlassCard";
import MetricTile from "@/components/MetricTile";

export default function Dashboard() {
  const m = getMetrics();

  return (
    <main className="min-h-screen px-6 py-24 max-w-5xl mx-auto">
      <header className="mb-16">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Live</p>
        <h1 className="text-4xl md:text-5xl font-extralight mt-2">
          Decepticon · Activity
        </h1>
        <p className="mt-3 text-white/50 font-light">
          State rebuilt from <code className="text-white/70">data/</code> on every commit.
          The Git history is the source of truth.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricTile label="Lines written today" value={m.linesToday} />
        <Link href="/roadblocks/" className="contents">
          <MetricTile label="Active roadblocks" value={m.activeRoadblocks} />
        </Link>
        <MetricTile label="Self-healed" value={m.selfHealed} />
      </section>

      <section className="mt-12">
        <GlassCard>
          <h2 className="text-xs uppercase tracking-[0.3em] text-white/40 mb-6">
            Recent activity
          </h2>
          {m.recent.length === 0 ? (
            <p className="text-white/40 font-light">No activity yet.</p>
          ) : (
            <ul className="space-y-3 text-white/70 font-light">
              {m.recent.map((r, i) => (
                <li
                  key={i}
                  className="flex justify-between border-b border-white/5 pb-3 last:border-0"
                >
                  <span>{r.title}</span>
                  <span className="text-white/40 text-sm tabular-nums">
                    {new Date(r.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </section>

      <footer className="mt-16 text-xs text-white/30 font-light">
        Snapshot built {new Date(m.updatedAt).toUTCString()} · total retries {m.totalAttempts.toLocaleString("en-US")}
      </footer>
    </main>
  );
}
