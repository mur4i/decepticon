"use client";

import { useEffect, useRef, useState } from "react";

const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "zh-CN", label: "中文" },
  { code: "ko", label: "한국어" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
];

const TRANSLATE_DOMAIN = ".translate.goog";
const MARKER = "";

function encodeHost(host: string): string {
  return host.replace(/-/g, "--").replace(/\./g, "-");
}

function decodeHost(encoded: string): string {
  return encoded.replace(/--/g, MARKER).replace(/-/g, ".").replace(new RegExp(MARKER, "g"), "-");
}

function currentLang(): string {
  if (typeof window === "undefined") return "en";
  const url = new URL(window.location.href);
  if (!url.hostname.endsWith(TRANSLATE_DOMAIN)) return "en";
  return url.searchParams.get("_x_tr_tl") ?? "en";
}

function buildUrl(target: string): string {
  if (typeof window === "undefined") return "#";
  const url = new URL(window.location.href);
  const onProxy = url.hostname.endsWith(TRANSLATE_DOMAIN);

  if (target === "en") {
    if (!onProxy) return url.href;
    const encoded = url.hostname.slice(0, -TRANSLATE_DOMAIN.length);
    const original = decodeHost(encoded);
    const params = new URLSearchParams(url.search);
    for (const k of Array.from(params.keys())) {
      if (k.startsWith("_x_tr_")) params.delete(k);
    }
    const qs = params.toString();
    return `https://${original}${url.pathname}${qs ? `?${qs}` : ""}`;
  }

  if (onProxy) {
    const params = new URLSearchParams(url.search);
    params.set("_x_tr_tl", target);
    params.set("_x_tr_hl", target);
    return `${url.origin}${url.pathname}?${params.toString()}`;
  }

  const encoded = encodeHost(url.hostname);
  const params = new URLSearchParams(url.search);
  params.set("_x_tr_sl", "en");
  params.set("_x_tr_tl", target);
  params.set("_x_tr_hl", target);
  return `https://${encoded}${TRANSLATE_DOMAIN}${url.pathname}?${params.toString()}`;
}

export default function LanguageSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("en");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(currentLang());
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const display = current === "en" ? "EN" : current.toUpperCase();

  return (
    <div ref={ref} className="fixed top-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="px-3.5 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] text-white/70 bg-white/[0.06] backdrop-blur-xl border border-white/10 hover:bg-white/[0.1] hover:text-white transition"
      >
        {display} <span className="text-white/40 ml-0.5">▾</span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-2 min-w-[11rem] rounded-2xl border border-white/10 bg-black/70 backdrop-blur-2xl p-1.5 max-h-[60vh] overflow-y-auto shadow-2xl shadow-black/40"
        >
          {LANGS.map((l) => {
            const active = current === l.code;
            return (
              <li key={l.code}>
                <a
                  href={buildUrl(l.code)}
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 rounded-xl text-sm font-light transition ${
                    active
                      ? "text-white bg-white/[0.08]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {l.label}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
