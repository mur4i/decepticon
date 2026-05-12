"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SpeechReader from "./SpeechReader";

// Piper voice per supported language. Languages without a voice fall back to
// the browser Web Speech API via SpeechReader.
const VOICE_BY_LANG: Record<string, string> = {
  en: "en_US-libritts_r-medium",
  pt: "pt_BR-faber-medium",
  es: "es_ES-davefx-medium",
  fr: "fr_FR-tom-medium",
  de: "de_DE-thorsten-medium",
  it: "it_IT-riccardo-x_low",
  ru: "ru_RU-denis-medium",
  "zh-CN": "zh_CN-huayan-medium",
};

type Status =
  | "idle"
  | "loading-model"
  | "synthesizing-first"
  | "playing"
  | "paused";

function detectLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const url = new URL(window.location.href);
    const tl = url.searchParams.get("_x_tr_tl");
    if (tl) return tl;
  } catch {}
  return "en";
}

function chunkText(text: string, maxLen = 180): string[] {
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

  // Make the first chunk short so playback starts fast.
  if (chunks.length > 0 && chunks[0].length > 100) {
    const first = chunks[0];
    const cut = first.slice(0, 100).match(/.*[.!?,;:]/);
    if (cut) {
      const head = cut[0].trim();
      const tail = first.slice(head.length).trim();
      chunks[0] = head;
      if (tail) chunks.splice(1, 0, tail);
    }
  }
  return chunks;
}

export default function PiperReader({
  targetSelector = ".chronicle-body",
}: {
  targetSelector?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState("en");
  const [status, setStatus] = useState<Status>("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [chunkProgress, setChunkProgress] = useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });

  const sessionRef = useRef<unknown | null>(null);
  const sessionVoiceRef = useRef<string | null>(null);
  const queueRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const producerDoneRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    setLang(detectLang());
  }, []);

  const voiceId = VOICE_BY_LANG[lang];

  const cleanup = useCallback(() => {
    cancelledRef.current = true;
    queueRef.current = [];
    const a = currentAudioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    currentAudioRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  async function ensureSession() {
    if (sessionRef.current && sessionVoiceRef.current === voiceId) {
      return sessionRef.current;
    }
    setStatus("loading-model");
    setModelProgress(0);
    const mod = await import("@mintplex-labs/piper-tts-web");
    const session = await mod.TtsSession.create({
      voiceId: voiceId as never,
      progress: (p: { loaded: number; total: number }) => {
        if (p.total > 0) {
          setModelProgress(Math.round((p.loaded / p.total) * 100));
        }
      },
      // Library default points at cdnjs/onnxruntime-web@1.18.0 which lacks
      // ort-wasm-simd-threaded.jsep.mjs (introduced in 1.19). Pin to jsdelivr
      // at 1.19.2, which mirrors the full npm dist/ tree.
      wasmPaths: {
        onnxWasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/",
        piperData:
          "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
        piperWasm:
          "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
      },
    });
    sessionRef.current = session;
    sessionVoiceRef.current = voiceId;
    return session;
  }

  function playNextFromQueue() {
    if (cancelledRef.current) return;
    if (currentAudioRef.current) return;
    const blob = queueRef.current.shift();
    if (!blob) {
      if (producerDoneRef.current) {
        setStatus("idle");
        setChunkProgress({ done: 0, total: 0 });
      } else {
        // Producer is still synthesizing — retry shortly.
        setTimeout(playNextFromQueue, 100);
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
      currentAudioRef.current = null;
      setChunkProgress((prev) => ({ done: prev.done + 1, total: prev.total }));
      playNextFromQueue();
    };
    audio.onerror = () => {
      currentAudioRef.current = null;
      playNextFromQueue();
    };
    currentAudioRef.current = audio;
    setStatus("playing");
    void audio.play();
  }

  async function start() {
    if (!voiceId) return;
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    const text = el?.innerText?.trim();
    if (!text) return;

    cancelledRef.current = false;
    queueRef.current = [];
    producerDoneRef.current = false;

    const session = (await ensureSession()) as {
      predict: (t: string) => Promise<Blob>;
    };

    const chunks = chunkText(text);
    setChunkProgress({ done: 0, total: chunks.length });
    setStatus("synthesizing-first");

    // Producer: synthesize chunks sequentially, push into queue.
    (async () => {
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (cancelledRef.current) return;
          const blob = await session.predict(chunks[i]);
          if (cancelledRef.current) return;
          queueRef.current.push(blob);
          if (!currentAudioRef.current) playNextFromQueue();
        }
      } catch (err) {
        console.error("[PiperReader] producer error", err);
      } finally {
        producerDoneRef.current = true;
      }
    })();
  }

  function pause() {
    currentAudioRef.current?.pause();
    setStatus("paused");
  }
  function resume() {
    currentAudioRef.current?.play();
    setStatus("playing");
  }
  function stop() {
    cleanup();
    cancelledRef.current = false;
    setStatus("idle");
    setChunkProgress({ done: 0, total: 0 });
  }

  if (!mounted) return null;

  // Language has no Piper voice — fall back to native Web Speech API.
  if (!voiceId) {
    return <SpeechReader lang={lang} targetSelector={targetSelector} />;
  }

  const pillBase =
    "px-3.5 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] font-light bg-white/6 backdrop-blur-xl border border-white/10 transition";

  if (status === "loading-model") {
    return (
      <div className={`${pillBase} text-white/60 inline-flex items-center gap-2`}>
        <span className="inline-block w-2 h-2 rounded-full bg-white/40 animate-pulse" />
        Loading voice {modelProgress > 0 ? `${modelProgress}%` : ""}
      </div>
    );
  }

  if (status === "synthesizing-first") {
    return (
      <div className={`${pillBase} text-white/60 inline-flex items-center gap-2`}>
        <span className="inline-block w-2 h-2 rounded-full bg-white/40 animate-pulse" />
        Synthesizing…
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
            {chunkProgress.total > 1 && (
              <span className="ml-2 text-white/40 normal-case tracking-normal">
                {chunkProgress.done}/{chunkProgress.total}
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
