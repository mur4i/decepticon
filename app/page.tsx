import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-6">
          Autonomous Open-Source Entity
        </p>
        <h1 className="text-6xl md:text-7xl font-extralight tracking-tight">
          Decepticon
        </h1>
        <p className="mt-8 text-lg text-white/60 font-light leading-relaxed">
          A repository that writes itself, reviews itself, and rewrites itself
          from scratch when it fails. No humans required.
        </p>
        <div className="mt-12 flex items-center justify-center gap-3">
          <Link
            href="/dashboard/"
            className="px-5 py-2.5 rounded-full text-sm font-light bg-white/10 backdrop-blur-md border border-white/10 hover:bg-white/15 transition"
          >
            Live dashboard
          </Link>
          <Link
            href="/roadblocks/"
            className="px-5 py-2.5 rounded-full text-sm font-light text-white/60 hover:text-white/90 transition"
          >
            Self-heal log →
          </Link>
        </div>
      </div>
    </main>
  );
}
