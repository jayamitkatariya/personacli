import { join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { getWorkspace } from "./state.js";
import type { ChatMessage, ChatMeta, ChatSearchHit, ChatTranscript } from "../shared/types.js";

export interface ChatTranscriptFile {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

function chatsDirPath(): string {
  const ws = getWorkspace();
  if (!ws) throw new Error("Workspace not configured");
  return join(ws, ".persona", "chats");
}

async function ensureChatsDir(): Promise<string> {
  const dir = chatsDirPath();
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id) && !id.includes("..");
}

function fileFor(id: string): string {
  return join(chatsDirPath(), `${id}.json`);
}

function toMeta(t: ChatTranscriptFile): ChatMeta {
  const last = t.messages[t.messages.length - 1];
  const preview = last
    ? last.role === "user"
      ? `You: ${last.content.slice(0, 90)}`
      : last.content.slice(0, 90)
    : "";
  return {
    id: t.id,
    title: t.title || "Untitled chat",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    preview,
  };
}

export async function listChats(): Promise<ChatMeta[]> {
  const dir = await ensureChatsDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const metas: ChatMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as ChatTranscriptFile;
      if (!parsed || !parsed.id || !Array.isArray(parsed.messages)) continue;
      metas.push(toMeta(parsed));
    } catch {
      // skip corrupt chat files
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<ChatTranscript | null> {
  if (!safeId(id)) return null;
  try {
    const raw = await readFile(fileFor(id), "utf8");
    const parsed = JSON.parse(raw) as ChatTranscriptFile;
    if (!parsed || !parsed.id) return null;
    return { ...toMeta(parsed), messages: parsed.messages };
  } catch {
    return null;
  }
}

export async function saveChat(id: string, input: { title?: string; messages: ChatMessage[] }): Promise<ChatTranscript> {
  if (!safeId(id)) throw new Error("Invalid chat id");
  const dir = await ensureChatsDir();
  const existing = await getChat(id);
  const now = Date.now();
  const transcript: ChatTranscriptFile = {
    id,
    title: input.title?.trim() ? input.title.trim().slice(0, 80) : existing?.title ?? "Untitled chat",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: input.messages,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(fileFor(id), JSON.stringify(transcript, null, 2), "utf8");
  
  return { ...toMeta(transcript), messages: transcript.messages };
}

export async function deleteChat(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  try {
    await rm(fileFor(id), { force: true });
    
    return true;
  } catch {
    return false;
  }
}

export async function searchChats(q: string): Promise<ChatSearchHit[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const dir = await ensureChatsDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const hits: ChatSearchHit[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as ChatTranscriptFile;
      if (!parsed || !Array.isArray(parsed.messages)) continue;
      let snippet = "";
      for (const m of parsed.messages) {
        const idx = m.content.toLowerCase().indexOf(query);
        if (idx !== -1) {
          const start = Math.max(0, idx - 40);
          snippet = (start > 0 ? "…" : "") + m.content.slice(start, idx + query.length + 60).replace(/\s+/g, " ").trim() + "…";
          break;
        }
      }
      if (snippet || parsed.title.toLowerCase().includes(query)) {
        hits.push({
          id: parsed.id,
          title: parsed.title || "Untitled chat",
          snippet: snippet || "…",
          updatedAt: parsed.updatedAt,
        });
      }
    } catch {
      // skip corrupt chat files
    }
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
}
