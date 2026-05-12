"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SpeechReader from "./SpeechReader";

const WORKER_URL = (process.env.NEXT_PUBLIC_TTS_WORKER_URL ?? "").replace(/\/$/, "");

// Lang code → Microsoft Edge neural voice. Same map as the Worker's defaults,
// kept here for fast local selection without round-tripping /voices.
const VOICE_BY_LANG: Record<string, string> = {
  en: "en-US-AriaNeural",
  pt: "pt-BR-FranciscaNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  it: "it-IT-IsabellaNeural",
  ja: "ja-JP-NanamiNeural",
  ko: "ko-KR-SunHiNeural",
  "zh-CN": "zh-CN-XiaoxiaoNeural",
  ru: "ru-RU-SvetlanaNeural",
  ar: "ar-SA-ZariyahNeural",
  hi: "hi-IN-SwaraNeural",
};

type Status = "idle" | "loading" | "playing" | "paused";

function detectLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const url = new URL(window.location.href);
    const tl = url.searchParams.get("_x_tr_tl");
    if (tl) return tl;
  } catch {}
  return "en";
}

// URL length safety: keep each request's text under this so a GET stays well
// below the ~8 KB total URL limit common to browsers and edge proxies.
const CHUNK_MAX = 1200;

function chunkText(text: string, maxLen = CHUNK_MAX): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const piece of parts) {
    const p = piece.trim();
    if (!p) continue;
    if (p.length >= maxLen) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      for (let i = 0; i < p.length; i += maxLen) {
        chunks.push(p.slice(i, i + maxLen).trim());
      }
      continue;
    }
    if (buf.length + 1 + p.length > maxLen) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf} ${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export default function EdgeTtsReader({
  targetSelector = ".chronicle-body",
}: {
  targetSelector?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState("en");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const cancelledRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setLang(detectLang());
  }, []);

  const cleanup = useCallback(() => {
    cancelledRef.current = true;
    const a = currentAudioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    currentAudioRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  async function start() {
    if (!WORKER_URL) return;
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    const text = el?.innerText?.trim();
    if (!text) return;

    const voice = VOICE_BY_LANG[lang] ?? VOICE_BY_LANG.en;
    const chunks = chunkText(text);
    cancelledRef.current = false;
    setProgress({ done: 0, total: chunks.length });
    setStatus("loading");

    for (let i = 0; i < chunks.length; i++) {
      if (cancelledRef.current) return;
      const src = `${WORKER_URL}/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(chunks[i])}`;
      const audio = new Audio(src);
      currentAudioRef.current = audio;

      const finished = new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio element error"));
      });

      try {
        if (i === 0) {
          // Wait for it to actually start playing before flipping the state.
          await new Promise<void>((resolve, reject) => {
            audio.oncanplay = () => resolve();
            audio.onerror = () => reject(new Error("audio element error"));
            audio.play().catch(reject);
          });
          if (cancelledRef.current) return;
          setStatus("playing");
        } else {
          audio.play().catch(() => {});
        }
        await finished;
      } catch (err) {
        console.error("[EdgeTtsReader] chunk failed", err);
        cleanup();
        setStatus("idle");
        return;
      }

      setProgress((prev) => ({ done: prev.done + 1, total: prev.total }));
    }

    setStatus("idle");
    setProgress({ done: 0, total: 0 });
  }

  function pause() {
    currentAudioRef.current?.pause();
    setStatus("paused");
  }
  function resume() {
    currentAudioRef.current?.play().catch(() => {});
    setStatus("playing");
  }
  function stop() {
    cleanup();
    cancelledRef.current = false;
    setStatus("idle");
    setProgress({ done: 0, total: 0 });
  }

  if (!mounted) return null;

  // Worker URL not set → fall back to native Web Speech.
  if (!WORKER_URL) {
    return <SpeechReader lang={lang} targetSelector={targetSelector} />;
  }

  const pillBase =
    "px-3.5 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] font-light bg-white/6 backdrop-blur-xl border border-white/10 transition";

  if (status === "loading") {
    return (
      <div className={`${pillBase} text-white/60 inline-flex items-center gap-2`}>
        <span className="inline-block w-2 h-2 rounded-full bg-white/40 animate-pulse" />
        Loading voice…
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      {status === "idle" && (
        <button
          type="button"
          onClick={start}
          className={`${pillBase} text-white/70 hover:bg-white/10 hover:text-white`}
        >
          <span className="mr-1.5">▶</span>Listen
        </button>
      )}
      {status === "playing" && (
        <>
          <button
            type="button"
            onClick={pause}
            className={`${pillBase} text-white/70 hover:bg-white/10 hover:text-white`}
          >
            <span className="mr-1.5">❚❚</span>Pause
            {progress.total > 1 && (
              <span className="ml-2 text-white/40 normal-case tracking-normal">
                {progress.done}/{progress.total}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className={`${pillBase} text-white/50 hover:text-white/80`}
          >
            ■
          </button>
        </>
      )}
      {status === "paused" && (
        <>
          <button
            type="button"
            onClick={resume}
            className={`${pillBase} text-white/70 hover:bg-white/10 hover:text-white`}
          >
            <span className="mr-1.5">▶</span>Resume
          </button>
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className={`${pillBase} text-white/50 hover:text-white/80`}
          >
            ■
          </button>
        </>
      )}
    </div>
  );
}
