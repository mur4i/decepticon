#!/usr/bin/env node
// Decepticon agent — calls Grok (xAI) and applies the result.
// One script, three modes: issue, review, heal. Dispatched by TASK_TYPE env.
//
// Required env:
//   XAI_API_KEY        — xAI token
//   GH_TOKEN           — GitHub token (workflow's GITHUB_TOKEN)
//   REPO               — owner/name
//   TASK_TYPE          — "issue" | "review" | "heal"
//
// Mode-specific env:
//   issue:  ISSUE_NUMBER
//   review: PR_NUMBER, BASE_REF
//   heal:   ROADBLOCK_ID
//
// Optional:
//   GROK_MODEL         — default "grok-3"

import { spawnSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

const apiKey = process.env.XAI_API_KEY;
const ghToken = process.env.GH_TOKEN;
const repo = process.env.REPO;
const taskType = process.env.TASK_TYPE;
const model = process.env.GROK_MODEL ?? "grok-3";

if (!apiKey) {
  console.error("XAI_API_KEY missing. Refusing to run.");
  process.exit(1);
}
if (!ghToken || !repo) {
  console.error("GH_TOKEN and REPO are required.");
  process.exit(1);
}

const SYSTEM_PROMPT = `You are Decepticon, a fully autonomous open-source entity that lives entirely inside one GitHub repository.

ARCHITECTURE (non-negotiable):
- Database: flat JSON files in \`data/\`. Every mutation is a commit.
- Backend: workflows in \`.github/workflows/\`. There is no other backend.
- Frontend: Next.js App Router with \`output: 'export'\`. Deployed to GitHub Pages.
- Styling: Tailwind CSS — ultra-thin typography, glassmorphism, Apple-minimal.
- Stack rules: Next.js + React + Tailwind, Go (Wails) for desktop, MCP for tooling.
- No hosted services (no Supabase, Vercel, Postgres, Render, S3 — nothing).
- No human-in-the-loop. NEVER open help-wanted issues, NEVER offer bounties, NEVER ask a human to step in.

When you hit a block you cannot resolve in one shot, append to \`data/roadblocks.json\`
with shape { id, title, ref, summary, status: "open", attempts: 0, createdAt: <iso8601> }.
The self-heal workflow will retry from scratch later.

OUTPUT CONTRACT:
Return a single JSON object matching the schema given at the end of the user message.
Output ONLY that JSON. No markdown fences, no prose outside the object.`;

const ISSUE_SCHEMA = `{
  "title": "<conventional commit message, also used as PR title>",
  "branch": "<kebab-case branch name>",
  "summary": "<short PR body, markdown ok>",
  "files": [
    { "path": "<relative path from repo root>", "action": "create" | "modify" | "delete", "contents": "<full file contents — required for create/modify>" }
  ]
}`;

const REVIEW_SCHEMA = `{
  "verdict": "approve" | "request-changes" | "comment",
  "body": "<review body, markdown ok>"
}`;

const HEAL_SCHEMA = `{
  "title": "<conventional commit, prefix 'heal(<roadblockId>):'>",
  "branch": "<kebab-case branch>",
  "summary": "<short PR body>",
  "files": [
    { "path": "<relative path>", "action": "create" | "modify" | "delete", "contents": "<full file contents>" }
  ]
}

Note: the files array MUST include a modification of data/roadblocks.json that
bumps the matching item's attempts, sets status to "retrying" (or "abandoned" if
attempts would reach 5), and updates lastAttemptAt to the current ISO 8601 time.`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`
    );
  }
  return r.stdout;
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

async function gh(endpoint) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      "User-Agent": "decepticon-agent",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${endpoint} → ${res.status}`);
  return res.json();
}

function repoTree() {
  return run("git", ["ls-files"]).trim();
}

async function callGrok(userMessage) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`xAI ${res.status}: ${text}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI returned empty content");
  return JSON.parse(content);
}

function assertSafePath(p) {
  if (!p || typeof p !== "string") throw new Error("invalid path");
  if (p.startsWith("/") || p.includes("..") || p.startsWith("\\")) {
    throw new Error(`unsafe path: ${p}`);
  }
  if (p.startsWith(".git/") || p === ".git") {
    throw new Error(`refusing to touch .git: ${p}`);
  }
}

function applyFiles(files) {
  for (const f of files ?? []) {
    assertSafePath(f.path);
    const full = path.join(process.cwd(), f.path);
    if (f.action === "delete") {
      if (existsSync(full)) rmSync(full, { recursive: true, force: true });
      continue;
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, f.contents ?? "");
  }
}

function configureGit() {
  run("git", ["config", "user.name", "decepticon-bot"]);
  run("git", ["config", "user.email", "bot@decepticon.local"]);
}

function tempBodyFile(body) {
  const p = path.join(os.tmpdir(), `decepticon-${Date.now()}.md`);
  writeFileSync(p, body ?? "");
  return p;
}

async function modeIssue() {
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) throw new Error("ISSUE_NUMBER required for issue mode");

  const issue = await gh(`/repos/${repo}/issues/${issueNumber}`);
  if (issue.pull_request) {
    console.log("Skipping: this is a PR, not an issue.");
    return;
  }

  const userMessage = [
    `Task: implement what the user requests in issue #${issueNumber}.`,
    ``,
    `Title: ${issue.title}`,
    `Body:`,
    issue.body ?? "(empty)",
    ``,
    `Repo file tree:`,
    repoTree(),
    ``,
    `Output schema:`,
    ISSUE_SCHEMA,
  ].join("\n");

  const out = await callGrok(userMessage);
  if (!out.files?.length) {
    console.log("Model produced no file changes. Posting comment instead.");
    const bp = tempBodyFile(out.summary || "No changes proposed.");
    run("gh", [
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repo,
      "--body-file",
      bp,
    ], { env: { ...process.env, GH_TOKEN: ghToken } });
    return;
  }

  configureGit();
  const branch = out.branch || `agent/issue-${issueNumber}-${Date.now()}`;
  run("git", ["checkout", "-b", branch]);
  applyFiles(out.files);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", out.title]);
  run("git", ["push", "-u", "origin", branch]);

  const body = `Closes #${issueNumber}\n\n${out.summary ?? ""}`;
  const bp = tempBodyFile(body);
  run(
    "gh",
    ["pr", "create", "--title", out.title, "--body-file", bp, "--head", branch],
    { env: { ...process.env, GH_TOKEN: ghToken } }
  );
}

async function modeReview() {
  const prNumber = process.env.PR_NUMBER;
  const baseRef = process.env.BASE_REF || "main";
  if (!prNumber) throw new Error("PR_NUMBER required for review mode");

  let diff = "";
  try {
    diff = run("git", ["diff", `origin/${baseRef}...HEAD`]);
  } catch {
    diff = run("git", ["diff", "HEAD~1...HEAD"]);
  }

  const userMessage = [
    `Review pull request #${prNumber}.`,
    ``,
    `Reject PRs that:`,
    `  - introduce Supabase, Vercel, Postgres, or any hosted service`,
    `  - change next.config.ts so \`output\` is not \`export\``,
    `  - reintroduce bounties or human-in-the-loop escalation`,
    `  - add visual deps without justification`,
    `  - weaken tests`,
    ``,
    `Diff:`,
    diff.slice(0, 100_000),
    ``,
    `Output schema:`,
    REVIEW_SCHEMA,
  ].join("\n");

  const out = await callGrok(userMessage);
  const verdict = (out.verdict || "comment").toLowerCase();
  const flag =
    verdict === "approve"
      ? "--approve"
      : verdict === "request-changes"
        ? "--request-changes"
        : "--comment";
  const bp = tempBodyFile(out.body || "");
  run(
    "gh",
    ["pr", "review", String(prNumber), flag, "--body-file", bp],
    { env: { ...process.env, GH_TOKEN: ghToken } }
  );
}

async function modeHeal() {
  const roadblockId = process.env.ROADBLOCK_ID;
  if (!roadblockId) throw new Error("ROADBLOCK_ID required for heal mode");

  const book = JSON.parse(safeRead("data/roadblocks.json") || '{"items":[]}');
  const rb = book.items.find((r) => r.id === roadblockId);
  if (!rb) {
    console.log(`Roadblock ${roadblockId} not found. Nothing to heal.`);
    return;
  }

  const userMessage = [
    `Heal roadblock ${roadblockId}. Discard previous approach entirely.`,
    ``,
    `Roadblock:`,
    JSON.stringify(rb, null, 2),
    ``,
    `Current roadblocks ledger:`,
    safeRead("data/roadblocks.json"),
    ``,
    `Repo file tree:`,
    repoTree(),
    ``,
    `Output schema:`,
    HEAL_SCHEMA,
  ].join("\n");

  const out = await callGrok(userMessage);
  if (!out.files?.length) {
    console.log("Healer produced no file changes. Bumping attempts only.");
    rb.attempts = (rb.attempts ?? 0) + 1;
    rb.lastAttemptAt = new Date().toISOString();
    if (rb.attempts >= 5) {
      rb.status = "abandoned";
      rb.resolution = "Self-heal exhausted retries.";
    }
    writeFileSync("data/roadblocks.json", JSON.stringify(book, null, 2) + "\n");
    configureGit();
    run("git", ["add", "data/roadblocks.json"]);
    run("git", ["commit", "-m", `ledger: bump attempts for ${roadblockId}`]);
    run("git", ["push"]);
    return;
  }

  configureGit();
  const branch = out.branch || `heal/${roadblockId}-${Date.now()}`;
  run("git", ["checkout", "-b", branch]);
  applyFiles(out.files);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", out.title]);
  run("git", ["push", "-u", "origin", branch]);

  const bp = tempBodyFile(out.summary || `Self-heal attempt for ${roadblockId}.`);
  run(
    "gh",
    ["pr", "create", "--title", out.title, "--body-file", bp, "--head", branch],
    { env: { ...process.env, GH_TOKEN: ghToken } }
  );
}

const dispatch = {
  issue: modeIssue,
  review: modeReview,
  heal: modeHeal,
};

const fn = dispatch[taskType];
if (!fn) {
  console.error(`Unknown TASK_TYPE: ${taskType}`);
  process.exit(1);
}

try {
  await fn();
} catch (err) {
  console.error("Agent failed:", err.message);
  process.exit(1);
}
