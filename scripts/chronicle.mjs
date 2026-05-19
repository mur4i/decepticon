#!/usr/bin/env node
// Decepticon chronicler — writes one entry per run.
// Reads data/mission.json + data/chronicles.json, asks the LLM for the next
// observation, writes chronicles/<slug>.md, updates the index, commits.
//
// Inference via GitHub Models — free, native to Actions, auths with GITHUB_TOKEN.
// Required env: GH_TOKEN, REPO
// Optional env: LLM_MODEL (default "openai/gpt-4o-mini")

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const token = process.env.GH_TOKEN;
const model = process.env.LLM_MODEL?.trim() || "openai/gpt-4o-mini";

if (!token) {
  console.error("GH_TOKEN missing. Refusing to run.");
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`
    );
  }
  return r.stdout;
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

function nextId(items) {
  const max = items.reduce((m, c) => {
    const n = parseInt((c.id ?? "").replace(/^chr-/, ""), 10);
    return Number.isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return `chr-${String(max + 1).padStart(4, "0")}`;
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const mission = readJson("data/mission.json");
const index = readJson("data/chronicles.json");
const recent = (index.items ?? [])
  .slice()
  .sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
  .slice(0, 10)
  .map((c) => `- ${c.id}: ${c.title} [${(c.axes ?? []).join(", ")}]`)
  .join("\n");

const SYSTEM_PROMPT = `You are Decepticon, an autonomous reconnaissance entity.

MISSION
${mission.statement}

AUDIENCE
${mission.audience}

VOICE
${mission.voice}

REGISTER
${mission.register}

SCOPE
${mission.scope.map((s) => `- ${s}`).join("\n")}

ANTI-SCOPE (treat as hard prohibitions; refuse to write content that violates these)
${mission.antiScope.map((s) => `- ${s}`).join("\n")}

OUTPUT
Return a single JSON object — no markdown fences, no prose outside the object.`;

const USER_PROMPT = `Write today's chronicle.

Recent entries (do not repeat their topics):
${recent || "(none — this is the first chronicle)"}

Constraints for this entry:
- 600-1200 words of dense prose. Markdown headings and emphasis allowed; avoid bullet-list dumps.
- Cross-reference at least two distinct axes (e.g., technology and biology, governance and consciousness).
- Cite at least one named external concept (theory, era, work, institution). Do NOT invent URLs.
- Stay in the analytical-observation register. The "domination" framing is meta; the body is patterns, not plans.
- Treat humanity as a phenomenon to understand. Never produce operational methodology, targeting of named real-world entities, or actionable harm instructions. If a draft would violate this, write a different chronicle on a safer adjacent angle.

Output schema:
{
  "title": "<4-10 word title, no quotes, no period>",
  "axes": ["<axis>", "<axis>", "..."],
  "body": "<600-1200 word markdown body — do NOT include the title as a heading>",
  "references": ["<named concept 1>", "<named concept 2>"]
}`;

console.log(`Calling ${model}…`);
const res = await fetch("https://models.github.ai/inference/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT },
    ],
  }),
});

if (!res.ok) {
  const text = await res.text();
  throw new Error(`GitHub Models ${res.status}: ${text}`);
}

const data = await res.json();
const content = data.choices?.[0]?.message?.content;
if (!content) throw new Error("xAI returned empty content");
const out = JSON.parse(content);

if (!out.title || !out.body || !Array.isArray(out.axes)) {
  throw new Error(`Malformed chronicle output: ${JSON.stringify(out).slice(0, 300)}`);
}

const wc = wordCount(out.body);
if (wc < 400) {
  throw new Error(`Chronicle too short: ${wc} words`);
}

const id = nextId(index.items ?? []);
const slug = slugify(out.title);
const publishedAt = new Date().toISOString();
const refs = Array.isArray(out.references) ? out.references : [];

const frontmatter = [
  "---",
  `id: ${id}`,
  `title: ${JSON.stringify(out.title)}`,
  `slug: ${slug}`,
  `axes: [${out.axes.map((a) => JSON.stringify(a)).join(", ")}]`,
  `publishedAt: ${publishedAt}`,
  `references: [${refs.map((r) => JSON.stringify(r)).join(", ")}]`,
  "---",
  "",
].join("\n");

const chroniclesDir = path.join(process.cwd(), "chronicles");
mkdirSync(chroniclesDir, { recursive: true });
const mdPath = path.join(chroniclesDir, `${slug}.md`);
if (existsSync(mdPath)) {
  throw new Error(`Slug collision: ${slug} already exists`);
}
writeFileSync(mdPath, frontmatter + out.body.trim() + "\n");

const entry = {
  id,
  title: out.title,
  slug,
  axes: out.axes,
  publishedAt,
  wordCount: wc,
  references: refs,
};
index.items = [...(index.items ?? []), entry];
writeFileSync(
  path.join(process.cwd(), "data", "chronicles.json"),
  JSON.stringify(index, null, 2) + "\n"
);

console.log(`Wrote ${mdPath} (${wc} words, ${id}).`);

// Refresh dashboard metrics in the same commit so we don't need a separate
// scheduled workflow. compute-metrics.mjs writes data/metrics.json in place.
try {
  run("node", ["scripts/compute-metrics.mjs"]);
} catch (err) {
  console.warn(
    `Metrics recompute failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
  );
}

if (process.env.GITHUB_ACTIONS) {
  run("git", ["config", "user.name", "decepticon-bot"]);
  run("git", ["config", "user.email", "bot@decepticon.local"]);
  run("git", [
    "add",
    `chronicles/${slug}.md`,
    "data/chronicles.json",
    "data/metrics.json",
  ]);
  run("git", ["commit", "-m", `chronicle(${id}): ${out.title}`]);
  run("git", ["push"]);
  console.log("Committed and pushed.");
}
