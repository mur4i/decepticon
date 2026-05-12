import { readFileSync } from "node:fs";
import path from "node:path";
import index from "../data/chronicles.json";

export interface ChronicleEntry {
  id: string;
  title: string;
  slug: string;
  axes: string[];
  publishedAt: string;
  wordCount: number;
  references?: string[];
}

export interface ChronicleBody {
  entry: ChronicleEntry;
  body: string;
}

interface IndexFile {
  items: ChronicleEntry[];
}

export function getChronicles(): ChronicleEntry[] {
  return (index as IndexFile).items
    .slice()
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

export function getChronicleBySlug(slug: string): ChronicleBody | null {
  const entry = (index as IndexFile).items.find((c) => c.slug === slug);
  if (!entry) return null;
  const file = path.join(process.cwd(), "chronicles", `${entry.slug}.md`);
  const raw = readFileSync(file, "utf8");
  const body = stripFrontmatter(raw);
  return { entry, body };
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]+?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : raw;
}
