// Decepticon TTS Worker — Cloudflare Worker that proxies Microsoft Edge's
// online text-to-speech (the same one Edge's "Read aloud" feature uses) to
// any browser. Browsers can't open the upstream WebSocket directly because
// it requires headers the WebSocket API forbids (Sec-WebSocket-Version,
// Origin: chrome-extension://...). The Worker, running in a Node-like
// environment, can set those headers.
//
// Endpoints:
//   GET  /              — health check
//   GET  /voices        — JSON list of voices the Worker knows about
//   GET  /tts?voice=X&text=...&rate=0%  — streams MP3 audio
//   POST /tts (JSON body { voice, text, rate? })  — same, no URL length limit

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION = "1-143.0.3650.75";
const WIN_EPOCH_OFFSET = 11644473600; // seconds between 1601-01-01 and 1970-01-01

// Microsoft added a signed token (Sec-MS-GEC) in 2024 that must travel with
// every TTS connection. It's a SHA-256 of "<windows-ticks-floored-to-5min>
// <TrustedClientToken>", uppercased.
async function generateSecMsGec(): Promise<string> {
  const seconds =
    Math.floor((Date.now() / 1000 + WIN_EPOCH_OFFSET) / 300) * 300;
  const ticks = BigInt(seconds) * 10000000n;
  const data = `${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function buildTtsUrl(): Promise<string> {
  const sec = await generateSecMsGec();
  const connectionId = crypto.randomUUID().replace(/-/g, "");
  const params = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    "Sec-MS-GEC": sec,
    "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
    ConnectionId: connectionId,
  });
  return `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${params.toString()}`;
}
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "Decepticon TTS Worker. POST /tts with { text, voice } or GET /tts?text=...&voice=...",
        { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } }
      );
    }

    if (url.pathname === "/voices") {
      return new Response(JSON.stringify(KNOWN_VOICES), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (url.pathname !== "/tts") {
      return new Response("Not found", { status: 404, headers: CORS });
    }

    let voice = url.searchParams.get("voice") ?? "en-US-AriaNeural";
    let text = url.searchParams.get("text") ?? "";
    let rate = url.searchParams.get("rate") ?? "0%";

    if (request.method === "POST") {
      try {
        const body = (await request.json()) as {
          voice?: string;
          text?: string;
          rate?: string;
        };
        if (body.voice) voice = body.voice;
        if (typeof body.text === "string") text = body.text;
        if (body.rate) rate = body.rate;
      } catch {
        return new Response("Invalid JSON body", { status: 400, headers: CORS });
      }
    }

    if (!text.trim()) {
      return new Response("text is required", { status: 400, headers: CORS });
    }

    try {
      const stream = await openTtsStream(text, voice, rate);
      return new Response(stream, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=3600",
          ...CORS,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`TTS upstream error: ${msg}`, {
        status: 502,
        headers: CORS,
      });
    }
  },
};

async function openTtsStream(
  text: string,
  voice: string,
  rate: string
): Promise<ReadableStream<Uint8Array>> {
  const wsUrl = await buildTtsUrl();
  const wsResp = await fetch(wsUrl, {
    headers: {
      Upgrade: "websocket",
      Origin: EDGE_ORIGIN,
      "User-Agent": EDGE_UA,
    },
  });
  const ws = wsResp.webSocket;
  if (!ws) {
    const bodyText = await wsResp.text().catch(() => "(no body)");
    throw new Error(
      `WebSocket upgrade failed: status=${wsResp.status} ${wsResp.statusText} body=${bodyText.slice(0, 400)}`
    );
  }
  ws.accept();

  const requestId = crypto.randomUUID().replace(/-/g, "");

  // rany2/edge-tts uses the JS `Date.prototype.toString()` format
  // ("Mon Jan 01 2024 00:00:00 GMT+0000 (Coordinated Universal Time)") and
  // appends a trailing CRLF after the SSML body — Microsoft silently emits no
  // audio frames if either is off.
  const timestamp = new Date().toString();

  const configMsg =
    `X-Timestamp:${timestamp}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
  ws.send(configMsg);

  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${escapeAttr(voice)}'>` +
    `<prosody rate='${escapeAttr(rate)}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  const ssmlMsg =
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp}Z\r\n` +
    `Path:ssml\r\n\r\n${ssml}\r\n`;
  ws.send(ssmlMsg);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Serialize the async Blob → ArrayBuffer conversion so audio frames
      // arrive in order even if the runtime delivers them concurrently.
      let pending: Promise<void> = Promise.resolve();

      ws.addEventListener("message", (event: MessageEvent) => {
        const data = event.data;
        if (typeof data === "string") {
          if (data.includes("Path:turn.end")) {
            pending = pending.then(() => {
              try { controller.close(); } catch {}
              try { ws.close(); } catch {}
            });
          }
          return;
        }

        // Binary frame layout: 2-byte big-endian header length, header text,
        // audio bytes. Cloudflare Workers deliver binary WS frames as Blob.
        pending = pending.then(async () => {
          const ab =
            data instanceof ArrayBuffer
              ? data
              : await (data as Blob).arrayBuffer();
          const buf = new Uint8Array(ab);
          if (buf.byteLength < 2) return;
          const headerLen = (buf[0] << 8) | buf[1];
          const audioStart = 2 + headerLen;
          if (audioStart >= buf.byteLength) return;
          try { controller.enqueue(buf.slice(audioStart)); } catch {}
        });
      });
      ws.addEventListener("close", () => {
        try { controller.close(); } catch {}
      });
      ws.addEventListener("error", () => {
        try { controller.error(new Error("upstream ws error")); } catch {}
      });
    },
    cancel() {
      try { ws.close(); } catch {}
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const KNOWN_VOICES: Record<string, string> = {
  en: "en-US-AriaNeural",
  "en-US": "en-US-AriaNeural",
  "en-GB": "en-GB-LibbyNeural",
  pt: "pt-BR-FranciscaNeural",
  "pt-BR": "pt-BR-FranciscaNeural",
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
