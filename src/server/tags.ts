import OpenAI from "openai";
import { getApiKey } from "./keychain.js";
import { resolveAiConfig } from "./ai.js";

const TAGS_LINE_RE = /^tags:.*$/m;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const MAX_TAGS = 5;
const MAX_CONTENT_CHARS = 4000;

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

function sanitizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

/** Tags currently declared in a note (`tags: [a, b]`). */
export function readTags(content: string): string[] {
  const line = [...content.matchAll(/^tags:.*$/gm)].at(-1)?.[0];
  if (!line) return [];
  const inner = line.slice(line.indexOf(":") + 1).trim().replace(/^\[|\]$/g, "");
  if (!inner) return [];
  return inner
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").toLowerCase())
    .filter((t) => /^[a-z0-9-]+$/.test(t))
    .slice(0, MAX_TAGS);
}

/** Merge new tags into the note, keeping existing ones. The `tags:` line lives at the bottom of the note. */
export function mergeTags(content: string, tags: string[]): string {
  const existing = readTags(content);
  const fresh = [
    ...new Set(tags.map(sanitizeTag).filter(Boolean)),
  ].filter((t) => !existing.includes(t));
  if (fresh.length === 0) return content;
  const all = [...existing, ...fresh].slice(0, MAX_TAGS);
  const line = `tags: [${all.join(", ")}]`;
  let body = content;
  const fmMatch = body.match(FRONTMATTER_RE);
  if (fmMatch) {
    const fmLines = (fmMatch[1] ?? "").split("\n");
    if (fmLines.some((l) => /^tags:.*$/.test(l))) {
      const nextFm = fmLines.filter((l) => !/^tags:.*$/.test(l)).join("\n").replace(/\n+$/, "");
      body = nextFm.trim()
        ? `---\n${nextFm}\n---\n${fmMatch[2] ?? ""}`
        : `${fmMatch[2] ?? ""}`;
      body = body
        .split("\n")
        .filter((l) => !/^tags:.*$/.test(l))
        .join("\n");
      return `${body.replace(/\s+$/, "")}\n\n${line}\n`;
    }
  }
  const lines = body.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^tags:.*$/.test(lines[i] ?? "")) {
      lines[i] = line;
      return lines.join("\n");
    }
  }
  return `${body.replace(/\s+$/, "")}\n\n${line}\n`;
}

const TAG_PROMPT = `You are Persona's note-tagger. You will be given the content of a Markdown note.

Suggest 3-5 short tags for it. Rules:
- Lowercase; use hyphens for multi-word tags (e.g. "deep-work").
- Tags should describe the note's main topics, not its mood.
- Do not include tags already present in the note.
- Reply with ONLY a JSON array of strings and nothing else. Example: ["work", "ideas", "meeting-notes"]`;

function extractTags(text: string): string[] {
  const stripped = text.replace(/```json|```/gi, "").trim();
  let arr: unknown = null;
  try {
    arr = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\[([\s\S]*?)\]/);
    if (m) {
      try {
        arr = JSON.parse(m[0]);
      } catch {
        arr = (m[1] ?? "").split(",");
      }
    }
  }
  if (Array.isArray(arr)) {
    return [
      ...new Set(
        arr
          .filter((t): t is string => typeof t === "string")
          .map(sanitizeTag)
          .filter(Boolean),
      ),
    ].slice(0, MAX_TAGS);
  }
  return [
    ...new Set(
      [...stripped.matchAll(/#?([a-z0-9][a-z0-9-]*)/gi)]
        .map((m) => sanitizeTag(m[1] ?? ""))
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
}

/**
 * Ask the configured AI for tags for a note. Returns [] when no API key is
 * configured (and no local model is running) or the provider call fails —
 * the feature degrades to a no-op.
 */
export async function suggestTags(content: string): Promise<string[]> {
  let apiKey = await getApiKey();
  const { baseUrl, model, local } = await resolveAiConfig();
  if (!apiKey) {
    if (local || isLocalEndpoint(baseUrl)) {
      // Ollama's OpenAI-compatible API accepts any key — no setup required.
      apiKey = "ollama";
    } else {
      return [];
    }
  }
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const trimmed = content.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS);
  // Stream the response — some providers (e.g. xiaomimimo) return empty
  // content on non-streaming requests. Avoid max_tokens: it is ignored or
  // breaks output on several OpenAI-compatible providers.
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: TAG_PROMPT },
      { role: "user", content: trimmed || "(empty note)" },
    ],
    temperature: 0.3,
  });
  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content ?? "";
  }
  return extractTags(text);
}
