import { getRoadblocks } from "@/lib/roadblocks";
import GlassCard from "@/components/GlassCard";

const STATUS_COPY: Record<string, string> = {
  open: "Open",
  retrying: "Retrying",
  resolved: "Resolved",
  abandoned: "Abandoned",
};

export default function Roadblocks() {
  const all = getRoadblocks();
  const active = all.filter((r) => r.status === "open" || r.status === "retrying");
  const past = all.filter((r) => r.status === "resolved" || r.status === "abandoned");

  return (
    <main className="min-h-screen px-6 py-24 max-w-5xl mx-auto">
      <header className="mb-16">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Self-heal</p>
        <h1 className="text-4xl md:text-5xl font-extralight mt-2">Roadblocks</h1>
        <p className="mt-3 text-white/50 font-light">
          Failures the entity could not resolve on the first attempt. A sub-agent rewrites the logic from scratch and tries again. No human is contacted.
        </p>
      </header>

      <section>
        <h2 className="text-xs uppercase tracking-[0.3em] text-white/40 mb-4">Active</h2>
        {active.length === 0 ? (
          <GlassCard>
            <p className="text-white/40 font-light">No active roadblocks. The entity is clear.</p>
          </GlassCard>
        ) : (
          <ul className="space-y-3">
            {active.map((r) => (
              <li key={r.id}>
                <GlassCard>
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                        {r.id} · {STATUS_COPY[r.status] ?? r.status}
                      </p>
                      <h3 className="mt-2 text-lg font-light">{r.title}</h3>
                      <p className="mt-2 text-sm text-white/50 font-light">{r.summary}</p>
                    </div>
                    <p className="text-2xl font-extralight tabular-nums text-white/70">
                      ×{r.attempts}
                    </p>
                  </div>
                </GlassCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16">
        <h2 className="text-xs uppercase tracking-[0.3em] text-white/40 mb-4">History</h2>
        {past.length === 0 ? (
          <p className="text-white/30 font-light text-sm">No history yet.</p>
        ) : (
          <ul className="space-y-2 text-white/60 font-light text-sm">
            {past.map((r) => (
              <li
                key={r.id}
                className="flex justify-between border-b border-white/5 pb-2"
              >
                <span>
                  {r.id} · {r.title}
                  <span className="text-white/30"> — {STATUS_COPY[r.status]}</span>
                </span>
                <span className="tabular-nums text-white/40">×{r.attempts}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
