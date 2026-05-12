"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "playing" | "paused";

const NEURAL_HINTS = /natural|online|premium|enhanced|neural|google|aria|jenny|antonio/i;

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
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

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
    };
  }, []);

  function start() {
    if (!supported) return;
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    const text = el?.innerText?.trim();
    if (!text) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const targetLang = currentTargetLang(lang);
    const voice = pickBestVoice(voices, targetLang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = targetLang;
    }
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setStatus("idle");
    utterance.onerror = () => setStatus("idle");
    utterRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }

  function pause() {
    window.speechSynthesis.pause();
    setStatus("paused");
  }
  function resume() {
    window.speechSynthesis.resume();
    setStatus("playing");
  }
  function stop() {
    window.speechSynthesis.cancel();
    setStatus("idle");
  }

  if (!supported) return null;

  const pillBase =
    "px-3.5 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] font-light bg-white/[0.06] backdrop-blur-xl border border-white/10 transition";

  return (
    <div className="inline-flex items-center gap-2">
      {status === "idle" && (
        <button
          type="button"
          onClick={start}
          className={`${pillBase} text-white/70 hover:bg-white/[0.1] hover:text-white`}
        >
          <span className="mr-1.5">▶</span>Listen
        </button>
      )}
      {status === "playing" && (
        <>
          <button
            type="button"
            onClick={pause}
            className={`${pillBase} text-white/70 hover:bg-white/[0.1] hover:text-white`}
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
            className={`${pillBase} text-white/70 hover:bg-white/[0.1] hover:text-white`}
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
