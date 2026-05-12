#!/usr/bin/env node
// Rebuild data/metrics.json from Git history + data/roadblocks.json.
// Runs in GitHub Actions; the commit triggers deploy.yml.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const token = process.env.GH_TOKEN;
const repo = process.env.REPO;

async function gh(url) {
  if (!token || !repo) return null;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "decepticon-metrics",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8"));
  } catch {
    return null;
  }
}

function linesAddedToday() {
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const shas = execSync(
      `git log --since="${since.toISOString()}" --pretty=format:%H`,
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);
    let added = 0;
    for (const sha of shas) {
      const stat = execSync(`git show --numstat --format= ${sha}`, {
        encoding: "utf8",
      });
      for (const line of stat.split("\n")) {
        const [a] = line.split("\t");
        const n = parseInt(a, 10);
        if (!Number.isNaN(n)) added += n;
      }
    }
    return added;
  } catch {
    return 0;
  }
}

async function recentEvents() {
  const data = await gh(`/repos/${repo}/events?per_page=20`);
  if (!Array.isArray(data)) return [];
  return data
    .filter((e) =>
      ["PushEvent", "PullRequestEvent", "IssuesEvent", "IssueCommentEvent"].includes(e.type)
    )
    .slice(0, 6)
    .map((e) => {
      const action = e.payload?.action ?? "";
      const title =
        e.payload?.issue?.title ??
        e.payload?.pull_request?.title ??
        e.payload?.commits?.[0]?.message?.split("\n")[0] ??
        "";
      return {
        title: `${e.type.replace("Event", "")} · ${action} ${title}`.trim(),
        at: e.created_at,
      };
    });
}

const roadblocks = readJson("data/roadblocks.json") ?? { items: [] };
const chronicles = readJson("data/chronicles.json") ?? { items: [] };

const activeRoadblocks = roadblocks.items.filter(
  (r) => r.status === "open" || r.status === "retrying"
).length;
const selfHealed = roadblocks.items.filter((r) => r.status === "resolved").length;
const totalAttempts = roadblocks.items.reduce(
  (s, r) => s + (r.attempts ?? 0),
  0
);
const chroniclesWritten = (chronicles.items ?? []).length;

const metrics = {
  linesToday: linesAddedToday(),
  activeRoadblocks,
  selfHealed,
  totalAttempts,
  chroniclesWritten,
  recent: await recentEvents(),
  updatedAt: new Date().toISOString(),
};

const out = path.join(process.cwd(), "data", "metrics.json");
writeFileSync(out, JSON.stringify(metrics, null, 2) + "\n");
console.log("Wrote", out, metrics);
