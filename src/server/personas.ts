import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { getWorkspace } from "./state.js";
import type { Persona } from "../shared/types.js";

const BUILTINS: Persona[] = [
  { id: "default", name: "Default", prompt: "", builtin: true },
  {
    id: "concise",
    name: "Concise",
    prompt:
      "Answer as briefly as possible. Use short sentences and bullet points. No preamble, no filler, no restating the question.",
    builtin: true,
  },
  {
    id: "developer",
    name: "Developer",
    prompt:
      "Act as a senior software engineer. Prefer precise technical language and code examples. When suggesting changes, show concrete diffs or snippets rather than descriptions.",
    builtin: true,
  },
  {
    id: "writer",
    name: "Writer",
    prompt:
      "Act as a skilled editor and writing partner. Favor clear, engaging prose; suggest improvements to flow, structure, and word choice when relevant.",
    builtin: true,
  },
];

function humanize(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal frontmatter parser — supports an optional `name:` field. */
function parsePersonaFile(raw: string): { name?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { body: raw };
  let name: string | undefined;
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^\s*name\s*:\s*(.+?)\s*$/.exec(line);
    if (kv) name = kv[1]!.replace(/^["']|["']$/g, "");
  }
  return { name, body: raw.slice(match[0].length) };
}

async function readUserPersonas(): Promise<Persona[]> {
  const ws = getWorkspace();
  if (!ws) return [];
  const dir = join(ws, ".persona", "personas");
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: Persona[] = [];
  for (const filename of entries) {
    if (!filename.toLowerCase().endsWith(".md")) continue;
    try {
      const raw = await readFile(join(dir, filename), "utf8");
      const { name, body } = parsePersonaFile(raw);
      const prompt = body.trim();
      if (!prompt) continue;
      const base = humanize(filename);
      out.push({
        id: `user:${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: name || base,
        prompt,
        builtin: false,
      });
    } catch {
      // skip unreadable persona files
    }
  }
  return out;
}

export async function listPersonas(): Promise<Persona[]> {
  return [...BUILTINS, ...(await readUserPersonas())];
}
