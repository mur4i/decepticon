#!/usr/bin/env node
// Pick the oldest unresolved roadblock under the attempt cap and emit its
// fields to GITHUB_OUTPUT so self-heal.yml can pass them to the agent.
import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const MAX_ATTEMPTS = 5;

const file = path.join(process.cwd(), "data", "roadblocks.json");
let book;
try {
  book = JSON.parse(readFileSync(file, "utf8"));
} catch {
  book = { items: [] };
}

const candidates = (book.items ?? [])
  .filter(
    (r) =>
      (r.status === "open" || r.status === "retrying") &&
      (r.attempts ?? 0) < MAX_ATTEMPTS
  )
  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const next = candidates[0];
const out = process.env.GITHUB_OUTPUT;

function emit(key, value) {
  const line = `${key}=${(value ?? "").toString().replace(/\r?\n/g, " ")}\n`;
  if (out) appendFileSync(out, line);
  else process.stdout.write(line);
}

if (!next) {
  emit("id", "");
  emit("title", "");
  emit("ref", "");
  console.log("No active roadblocks.");
} else {
  emit("id", next.id);
  emit("title", next.title);
  emit("ref", next.ref ?? "");
  console.log(`Healing ${next.id} (attempt ${(next.attempts ?? 0) + 1}/${MAX_ATTEMPTS})`);
}
