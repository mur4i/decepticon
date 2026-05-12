# Decepticon TTS Worker

A tiny Cloudflare Worker that proxies Microsoft Edge's online neural TTS to any
browser. Edge's WebSocket endpoint requires headers browsers can't set, so we
relay through this Worker. Free tier (100 000 requests/day) is plenty.

## One-time deploy

```bash
cd worker
npm install
npx wrangler login         # opens a browser, free Cloudflare account
npx wrangler deploy
```

Wrangler prints a URL like `https://decepticon-tts.<your-subdomain>.workers.dev`.

Then expose that URL to the Next.js app by setting a **repo variable** on GitHub:

- Settings → Secrets and variables → Actions → **Variables** → New variable
- Name: `NEXT_PUBLIC_TTS_WORKER_URL`
- Value: `https://decepticon-tts.<your-subdomain>.workers.dev`

Push any commit (or trigger the deploy workflow manually) and the chronicle
pages will start using the Worker for narration. Without the variable set,
the pages quietly fall back to the browser's native Web Speech API.

## Local dev

```bash
cd worker
npx wrangler dev
# → http://localhost:8787
# Try: http://localhost:8787/tts?voice=pt-BR-FranciscaNeural&text=Olá%20mundo
```

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/` | — | health string |
| GET | `/voices` | — | JSON of `lang → voice` map the Worker knows |
| GET | `/tts` | `?voice=&text=&rate=` | streamed `audio/mpeg` |
| POST | `/tts` | `{ voice, text, rate? }` | streamed `audio/mpeg` |

`rate` is SSML prosody, e.g. `+10%`, `-15%`, `0%` (default).

## Voices

The full Microsoft neural catalog is available — anything documented under
"Available voice list" in the Azure Speech docs. Common picks:

| Lang | Voice |
|---|---|
| `en-US` | `en-US-AriaNeural`, `en-US-JennyNeural`, `en-US-GuyNeural` |
| `pt-BR` | `pt-BR-FranciscaNeural`, `pt-BR-AntonioNeural` |
| `es-ES` | `es-ES-ElviraNeural`, `es-ES-AlvaroNeural` |
| `fr-FR` | `fr-FR-DeniseNeural`, `fr-FR-HenriNeural` |
| `de-DE` | `de-DE-KatjaNeural`, `de-DE-ConradNeural` |
| `ja-JP` | `ja-JP-NanamiNeural`, `ja-JP-KeitaNeural` |

## Why this exists

`speech.platform.bing.com` rejects WebSocket upgrades that don't carry
`Origin: chrome-extension://...` and a few Edge-specific headers. The browser
WebSocket API silently strips custom headers, so direct browser access only
works from Edge itself. Workers can set those headers, so the round trip is:

```
Browser fetch  →  Worker  →  Microsoft WSS  →  Worker stream  →  <audio>
```

Same neural voices the Edge "Read aloud" feature uses (Aria, Jenny, Antonio,
Francisca, etc.). No API key, no Azure account.

## Compliance note

Microsoft hasn't sanctioned non-Edge clients using this endpoint, but the
community has been doing it for ~3 years without enforcement. If this ever
breaks, the fallback path in the frontend (Web Speech API) keeps the site
functional, just lower quality.
