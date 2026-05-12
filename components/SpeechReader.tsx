"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "playing" | "paused";

const NEURAL_HINTS = /natural|online|premium|enhanced|neural|google|aria|jenny|antonio/i;
const CHUNK_MAX = 180;

function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  langCode: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const prefix = (langCode || "en").split("-")[0].toLowerCase();
  const candidates = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(prefix)
  );
  if (candidates.length === 0) return null;
  const neural = candidates.filter((v) => NEURAL_HINTS.test(v.name));
  return neural[0] ?? candidates[0];
}

function currentTargetLang(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const url = new URL(window.location.href);
    const tl = url.searchParams.get("_x_tr_tl");
    if (tl) return tl;
  } catch {}
  return fallback;
}

// Chrome silently caps utterances at ~200 chars / ~15s. Split into chunks at
// sentence/clause boundaries so each speak() stays well below the cliff.
function chunkText(text: string, maxLen = CHUNK_MAX): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .match(/[^.!?\n;:]+(?:[.!?\n;:]+|$)/g) ?? [text];
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
      // Split overlong piece on word boundaries.
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

export default function SpeechReader({
  lang = "en",
  targetSelector = ".chronicle-body",
}: {
  lang?: string;
  targetSelector?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const queueRef = useRef<string[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const langRef = useRef<string>(lang);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  function stopHeartbeat() {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    // Chromium also stops mid-stream after ~15s; pause/resume re-arms it.
    heartbeatRef.current = setInterval(() => {
      const ss = window.speechSynthesis;
      if (!ss.speaking) return;
      ss.pause();
      ss.resume();
    }, 12000);
  }

  function speakNextChunk() {
    const next = queueRef.current.shift();
    if (!next) {
      stopHeartbeat();
      setStatus("idle");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(next);
    const voice = voiceRef.current;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    // If no voice matched, leave lang/voice unset — Chrome will pick its OS
    // default. Setting `lang` to a code with no matching voice causes the
    // `language-unavailable` error and the utterance is dropped.
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => speakNextChunk();
    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      // `canceled` and `interrupted` are normal when the user hits Stop or
      // navigates away — don't treat as a real error.
      if (e.error === "canceled" || e.error === "interrupted") {
        stopHeartbeat();
        setStatus("idle");
        return;
      }
      console.error(
        "[SpeechReader] utterance error:",
        e.error,
        "| voice:",
        voice?.name ?? "(default)",
        "| lang:",
        utterance.lang || "(unset)",
        "| chunk:",
        JSON.stringify(next.slice(0, 80))
      );
      queueRef.current = [];
      stopHeartbeat();
      setStatus("idle");
    };
    window.speechSynthesis.speak(utterance);
  }

  function start() {
    if (!supported) return;
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    const text = el?.innerText?.trim();
    if (!text) {
      console.warn("[SpeechReader] no text to read at", targetSelector);
      return;
    }

    const currentVoices = window.speechSynthesis.getVoices();
    const targetLang = currentTargetLang(lang);
    voiceRef.current = pickBestVoice(currentVoices, targetLang);
    langRef.current = targetLang;
    queueRef.current = chunkText(text);

    window.speechSynthesis.cancel();
    setStatus("playing");
    startHeartbeat();
    speakNextChunk();
  }

  function pause() {
    window.speechSynthesis.pause();
    stopHeartbeat();
    setStatus("paused");
  }
  function resume() {
    window.speechSynthesis.resume();
    startHeartbeat();
    setStatus("playing");
  }
  function stop() {
    queueRef.current = [];
    stopHeartbeat();
    window.speechSynthesis.cancel();
    setStatus("idle");
  }

  // voices change asynchronously; keep voiceRef updated if user hasn't started yet
  useEffect(() => {
    if (status === "idle") {
      voiceRef.current = pickBestVoice(voices, currentTargetLang(lang));
    }
  }, [voices, lang, status]);

  if (!supported) return null;

  const pillBase =
    "px-3.5 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] font-light bg-white/6 backdrop-blur-xl border border-white/10 transition";

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
