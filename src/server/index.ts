import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEntry,
  deleteEntry,
  duplicateEntry,
  FsError,
  moveEntries,
  readFileContent,
  readTree,
  renameEntry,
  resolveSafe,
  writeFileContent,
  workspaceRoot,
} from "./fs.js";
import { broadcaster, startWatcher, stopWatcher } from "./watcher.js";
import { createTask, createTasksBulk, deleteTask, listTasks, parseTaskText, splitTaskText, updateTask } from "./tasks.js";
import { resolveAiConfig, streamChat } from "./ai.js";
import { detectOllama, detectOllamaEmbedding, invalidateOllamaCache } from "./ollama.js";
import { mergeTags, suggestTags } from "./tags.js";
import { triageTasks } from "./triage.js";
import { exportNote, exportTasks } from "./export.js";
import {
  clearApiKey,
  clearEmbeddingApiKey,
  getApiKey,
  hasApiKey,
  hasEmbeddingApiKey,
  setApiKey,
  setEmbeddingApiKey,
} from "./keychain.js";
import { ensureConfigDir, getWorkspace, readConfig, writeConfig, writeState } from "./state.js";
import { pickFolder } from "./pick-folder.js";
import { rebuildIndex, search } from "./search.js";
import { addPin, getPinboard, removePin, retargetPins } from "./pins.js";
import { getLastBuildError, loadSemanticIndex, rebuildSemanticIndex } from "./embeddings.js";
import { transcribeAudio } from "./stt.js";
import { deleteChat, getChat, listChats, saveChat, searchChats } from "./chats.js";
import { getLockSettings, updateLockSettings, verifyPin } from "./lock.js";
import { streamTransform, TRANSFORM_MODES } from "./transform.js";
import { DEFAULT_TYPOGRAPHY } from "../shared/types.js";
import type {
  ContextItem,
  ContextTarget,
  Density,
  FontFamily,
  LockSettings,
  Settings,
  TransformMode,
} from "../shared/types.js";

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof FsError) {
    return c.json({ error: err.message }, err.status as 400);
  }
  console.error("[persona] error:", err);
  return c.json({ error: "Internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ app: "persona", version: "0.1.0", ok: true }));

app.post("/api/stt/transcribe", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return c.json({ error: "Missing audio" }, 400);
  const audio = Buffer.from(await file.arrayBuffer());
  if (audio.length === 0) return c.json({ error: "Empty audio" }, 400);
  const ext = file.name.split(".").pop() ?? "webm";
  try {
    const text = await transcribeAudio(audio, ext, c.req.raw.signal);
    return c.json({ text });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return c.json({ error: "Aborted" }, 400);
    const message = err instanceof Error ? err.message : "Transcription failed";
    return c.json({ error: message }, 400);
  }
});

const journalPath = join(homedir(), ".persona", "journal.md");

app.post("/api/journal", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "Bad request" }, 400);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ensureConfigDir();
  appendFileSync(journalPath, `\n## ${stamp}\n\n${text}\n`);
  return c.json({ ok: true });
});

app.get("/api/settings", async (c) => {
  const config = readConfig();
  const ai = await resolveAiConfig();
  const settings: Settings = {
    configured: Boolean(config.workspace),
    workspace: config.workspace ?? "",
    defaultWorkspace: join(homedir(), "Persona"),
    theme: config.theme ?? "system",
    accent: config.accent,
    typography: config.typography
      ? { ...DEFAULT_TYPOGRAPHY, ...config.typography }
      : undefined,
    ai: {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      embeddingModel: config.ai?.embeddingModel || "text-embedding-3-small",
      hasKey: await hasApiKey(),
      backend: config.ai?.backend ?? "auto",
      embeddingBaseUrl: config.ai?.embeddingBaseUrl || "",
      embeddingHasKey: await hasEmbeddingApiKey(),
      embeddingLocal: await detectOllamaEmbedding(),
      local: await detectOllama(),
    },
  };
  return c.json(settings);
});

app.put("/api/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspace?: string;
    theme?: "light" | "dark" | "system";
    accent?: string;
    typography?: {
      fontFamily?: FontFamily;
      serifProse?: boolean;
      fontSize?: number;
      density?: Density;
      ligatures?: boolean;
    };
    ai?: {
      provider?: string;
      baseUrl?: string;
      model?: string;
      embeddingModel?: string;
      backend?: "auto" | "local" | "cloud";
      embeddingBaseUrl?: string;
    };
    aiKey?: string;
    embeddingAiKey?: string;
  };

  const config = readConfig();
  const embeddingEndpointChanged =
    body.ai?.embeddingBaseUrl !== undefined ||
    body.ai?.embeddingModel !== undefined ||
    body.embeddingAiKey !== undefined;

  if (body.workspace) {
    const ws = body.workspace.replace(/\/+$/, "");
    if (!ws.startsWith("/")) return c.json({ error: "Workspace must be an absolute path" }, 400);
    mkdirSync(ws, { recursive: true });
    mkdirSync(join(ws, ".persona", "tasks"), { recursive: true });
    config.workspace = ws;
    writeConfig(config);
    broadcaster.emitEvent({ type: "settings" });
    stopWatcher();
    startWatcher();
    void rebuildIndex();
    void rebuildSemanticIndex();
  }

  if (body.theme === "light" || body.theme === "dark" || body.theme === "system") {
    config.theme = body.theme;
    writeConfig(config);
    broadcaster.emitEvent({ type: "settings" });
  }

  if (typeof body.accent === "string") {
    if (/^#[0-9a-fA-F]{6}$/.test(body.accent)) {
      config.accent = body.accent.toLowerCase();
      writeConfig(config);
      broadcaster.emitEvent({ type: "settings" });
    }
  }

  if (body.typography) {
    const t = body.typography;
    const fontSize = [13, 14, 15, 16].includes(t.fontSize as number) ? (t.fontSize as 13 | 14 | 15 | 16) : undefined;
    config.typography = {
      fontFamily: t.fontFamily === "inter" || t.fontFamily === "plex" || t.fontFamily === "system"
        ? t.fontFamily
        : config.typography?.fontFamily,
      serifProse: typeof t.serifProse === "boolean" ? t.serifProse : config.typography?.serifProse,
      fontSize: fontSize ?? config.typography?.fontSize,
      density: t.density === "compact" || t.density === "comfortable" || t.density === "spacious"
        ? t.density
        : config.typography?.density,
      ligatures: typeof t.ligatures === "boolean" ? t.ligatures : config.typography?.ligatures,
    };
    writeConfig(config);
    broadcaster.emitEvent({ type: "settings" });
  }

  if (body.ai) {
    const backend = body.ai.backend;
    const embeddingBaseUrl = body.ai.embeddingBaseUrl?.trim();
    config.ai = {
      provider: body.ai.provider ?? config.ai?.provider,
      baseUrl: body.ai.baseUrl ?? config.ai?.baseUrl,
      model: body.ai.model ?? config.ai?.model,
      embeddingModel: body.ai.embeddingModel ?? config.ai?.embeddingModel,
      backend: backend === "auto" || backend === "local" || backend === "cloud"
        ? backend
        : config.ai?.backend ?? "auto",
      embeddingBaseUrl: embeddingBaseUrl === undefined
        ? config.ai?.embeddingBaseUrl
        : embeddingBaseUrl || undefined,
    };
    writeConfig(config);
    invalidateOllamaCache();
  }

  if (body.embeddingAiKey !== undefined) {
    if (body.embeddingAiKey === "") {
      await clearEmbeddingApiKey();
    } else {
      await setEmbeddingApiKey(body.embeddingAiKey);
    }
    broadcaster.emitEvent({ type: "settings" });
  }

  if (embeddingEndpointChanged) {
    void rebuildSemanticIndex();
  }

  if (body.aiKey !== undefined) {
    if (body.aiKey === "") {
      await clearApiKey();
    } else {
      await setApiKey(body.aiKey);
      void rebuildSemanticIndex();
    }
    broadcaster.emitEvent({ type: "settings" });
  }

  return c.json({ ok: true });
});

app.post("/api/pick-folder", async (c) => {
  const path = await pickFolder();
  return c.json({ path });
});

/* ------------------------------------------------------------------ */
/* First-run starter content (idempotent — never overwrites)           */
/* ------------------------------------------------------------------ */

const WELCOME_NOTE = `# Welcome to Persona

Your local-first workspace. Everything here is plain Markdown on your machine —
no accounts, no cloud, no database. If Persona disappeared tomorrow, your notes
and tasks would still just be files.

This note is your guide. Keep it, edit it, or delete it — it's only a file.

## What lives where

- **Notes/** — your daily journal notes and anything you write. \`Notes/YYYY-MM-DD.md\` is today's note.
- **Projects/** — one folder per project.
- **.persona/** — app data: tasks, pins, search index. Leave it alone.

## The three views

| View | What it's for |
| --- | --- |
| Write (⌘1) | Files, folders and a Markdown editor. \`⌘N\` new file, \`⌘T\` new draft. Autosaves as you type. |
| Tasks (⌘2) | A natural-language task list. Type \`Buy domain tomorrow #personal !!\` in the quick-add box. |
| Chat (⌘3) | An AI that can read and edit your workspace. Attach context with \`@file.md\`, \`@folder\` or \`@tasks\`. |

## Worth knowing

- **⌘K** command palette · **⌘P** quick search — finds notes by meaning too, once they're indexed.
- **⌘⇧N** new task · **⌘,** settings · **⌘⇧B** toggle sidebar · **Esc** closes anything.
- **Pinboard** — pin important notes or tasks (⋯ menu in the file tree or task row) and they stay pinned to the top of the sidebar.
- **Triage** — in Tasks, asks the AI to review your open tasks. Suggestions only; apply them one click at a time.
- **Focus** — start a timer bound to your open tasks from the command palette ("Start focus session").
- **AI tags** — press ⌘S or the ✨ button on a note and Persona suggests tags, added as YAML frontmatter.

## AI

Chat, AI tags, task triage and semantic search all need a model. Configure it in
**Settings → AI** (⌘,): any OpenAI-compatible provider works, or run
[Ollama](https://ollama.com) locally for zero-setup, no-key chat
(\`ollama pull llama3.2\`). \`persona doctor\` in the terminal reports what was detected.

## From the terminal

\`persona note "text"\` — log to today's note · \`persona task "..."\` — add a task ·
\`persona ask "..."\` — chat from the terminal · \`persona today\` — open today's journal note

---

Happy writing.
`;

app.post("/api/onboard", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const root = workspaceRoot();
  const created: string[] = [];
  const ensureDir = (rel: string) => {
    const full = join(root, rel);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      created.push(`${rel}/`);
    }
  };
  const ensureFile = (rel: string, content: string) => {
    const full = join(root, rel);
    if (!existsSync(full)) {
      writeFileSync(full, content, "utf8");
      created.push(rel);
    }
  };
  ensureDir("Notes");
  ensureDir("Projects");
  ensureFile("Notes/Welcome.md", WELCOME_NOTE);
  broadcaster.emitEvent({ type: "fs", paths: created });
  return c.json({ created });
});

app.post("/api/capture", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const path = `Notes/${today}.md`;
  let content = "";
  try {
    content = await readFileContent(path);
  } catch (err) {
    if (err instanceof FsError && err.status === 404) {
      await createEntry(path, "file", `# ${today}\n\n`);
    } else {
      throw err;
    }
  }
  if (text) {
    const separator = content && !content.endsWith("\n") ? "\n" : "";
    await writeFileContent(path, content + separator + `- ${text}\n`);
  }
  return c.json({ path });
});

app.get("/api/fs/tree", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const root = c.req.query("root");
  return c.json(await readTree(root ?? undefined));
});

app.get("/api/fs/content", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);
  const content = await readFileContent(path);
  return c.json({ content });
});

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
};

app.get("/api/fs/raw", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);
  const full = resolveSafe(path);
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(full).catch(() => {
    throw new FsError(404, "File not found");
  });
  const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    },
  });
});

app.put("/api/fs/content", async (c) => {
  const { path, content } = await c.req.json();
  if (!path || typeof content !== "string") return c.json({ error: "Bad request" }, 400);
  await writeFileContent(path, content);
  return c.json({ ok: true });
});

app.post("/api/notes/tags", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const { path, content } = await c.req.json().catch(() => ({}));
  if (typeof path !== "string" || typeof content !== "string") {
    return c.json({ error: "Bad request" }, 400);
  }
  try {
    const tags = await suggestTags(content);
    if (tags.length === 0) return c.json({ tags: [], content });
    const merged = mergeTags(content, tags);
    await writeFileContent(path, merged);
    return c.json({ tags, content: merged });
  } catch (err) {
    console.error("[persona] tag suggestion failed:", err);
    return c.json({ tags: [], content });
  }
});

app.post("/api/fs/create", async (c) => {
  const { path, type, content } = await c.req.json();
  if (!path || (type !== "file" && type !== "folder")) return c.json({ error: "Bad request" }, 400);
  const created = await createEntry(path, type, typeof content === "string" ? content : "");
  return c.json({ path: created });
});

app.post("/api/fs/rename", async (c) => {
  const { path, name } = await c.req.json();
  if (!path || !name) return c.json({ error: "Bad request" }, 400);
  const renamed = await renameEntry(path, name);
  if (renamed !== path) retargetPins(path, renamed);
  return c.json({ path: renamed });
});

app.post("/api/fs/move", async (c) => {
  const { paths, target } = await c.req.json();
  // target may be "" (or omitted) to move into the workspace root
  if (!Array.isArray(paths)) return c.json({ error: "Bad request" }, 400);
  const moved = await moveEntries(paths, typeof target === "string" ? target : "");
  paths.forEach((from, i) => {
    const to = moved[i];
    if (to && to !== from) retargetPins(from, to);
  });
  return c.json({ paths: moved });
});

app.post("/api/fs/duplicate", async (c) => {
  const { path } = await c.req.json();
  if (!path) return c.json({ error: "Bad request" }, 400);
  const created = await duplicateEntry(path);
  return c.json({ path: created });
});

app.delete("/api/fs/delete", async (c) => {
  const { path } = await c.req.json().catch(() => ({}));
  if (!path) return c.json({ error: "Bad request" }, 400);
  await deleteEntry(path);
  return c.json({ ok: true });
});

app.get("/api/fs/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const scope = c.req.query("scope") ?? undefined;
  return c.json(await search(q, scope));
});

app.post("/api/ai/reindex", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  try {
    const result = await rebuildSemanticIndex();
    if (!result) {
      return c.json(
        { error: getLastBuildError() ?? "No AI provider available for embeddings — add an API key in Settings → AI." },
        400,
      );
    }
    return c.json(result);
  } catch (err) {
    console.error("[persona] reindex failed:", err);
    return c.json({ error: err instanceof Error ? err.message : "Reindex failed" }, 500);
  }
});

app.get("/api/fs/context", async (c) => {
  const q = (c.req.query("q") ?? "").toLowerCase();
  const tree = await readTree();
  const items: ContextItem[] = [];
  const walk = (nodes: typeof tree) => {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(q) && node.name !== ".persona") {
        items.push({ type: node.type, path: node.path, label: node.path });
      }
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  items.push({ type: "tasks", path: "", label: "Tasks (all)" });
  return c.json(items.slice(0, 12));
});

app.get("/api/tasks", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  return c.json(await listTasks());
});

app.post("/api/tasks/parse", async (c) => {
  const { text } = await c.req.json();
  if (typeof text !== "string") return c.json({ error: "Bad request" }, 400);
  return c.json(parseTaskText(text));
});

app.post("/api/tasks/bulk/parse", async (c) => {
  const { text } = await c.req.json();
  if (typeof text !== "string") return c.json({ error: "Bad request" }, 400);
  const items = splitTaskText(text).map(parseTaskText);
  return c.json({ items });
});

app.post("/api/tasks/bulk", async (c) => {
  const { text } = await c.req.json();
  if (typeof text !== "string" || !text.trim()) return c.json({ error: "Bad request" }, 400);
  const tasks = await createTasksBulk(text);
  if (tasks.length === 0) return c.json({ error: "Nothing to add" }, 400);
  return c.json({ tasks });
});

app.post("/api/tasks", async (c) => {
  const { text } = await c.req.json();
  if (typeof text !== "string" || !text.trim()) return c.json({ error: "Bad request" }, 400);
  const task = await createTask(parseTaskText(text));
  return c.json(task);
});

app.put("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const task = await updateTask(id, body);
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(task);
});

app.delete("/api/tasks/:id", async (c) => {
  await deleteTask(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/tasks/triage", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  try {
    const tasks = await listTasks();
    const suggestions = await triageTasks(tasks);
    return c.json({ suggestions });
  } catch (err) {
    console.error("[persona] task triage failed:", err);
    const message = err instanceof Error && err.message ? err.message : "Task triage failed";
    return c.json({ error: message }, 400);
  }
});

/* ------------------------------------------------------------------ */
/* Chat persistence (structured transcripts under .persona/chats)      */
/* ------------------------------------------------------------------ */

app.get("/api/chats", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  return c.json(await listChats());
});

app.get("/api/chats/search", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  return c.json(await searchChats(c.req.query("q") ?? ""));
});

app.get("/api/chats/:id", async (c) => {
  const chat = await getChat(c.req.param("id"));
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  return c.json(chat);
});

app.put("/api/chats/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: unknown;
    messages?: unknown;
  };
  if (!Array.isArray(body.messages)) return c.json({ error: "Bad request" }, 400);
  const messages = body.messages.filter(
    (m): m is { id: string; role: "user" | "assistant"; content: string; createdAt: number } =>
      Boolean(m) &&
      typeof (m as { id?: unknown }).id === "string" &&
      ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
      typeof (m as { content?: unknown }).content === "string" &&
      typeof (m as { createdAt?: unknown }).createdAt === "number",
  );
  try {
    const saved = await saveChat(id, {
      title: typeof body.title === "string" ? body.title : undefined,
      messages,
    });
    broadcaster.emitEvent({ type: "chats" });
    return c.json(saved);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Could not save chat" }, 400);
  }
});

app.delete("/api/chats/:id", async (c) => {
  const ok = await deleteChat(c.req.param("id"));
  if (!ok) return c.json({ error: "Chat not found" }, 404);
  broadcaster.emitEvent({ type: "chats" });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* App lock (optional PIN, re-prompt after idle)                       */
/* ------------------------------------------------------------------ */

app.get("/api/lock", async (c) => {
  return c.json(await getLockSettings());
});

app.put("/api/lock", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    enabled?: unknown;
    idleMinutes?: unknown;
    pin?: unknown;
  };
  const input: { enabled?: boolean; idleMinutes?: number; pin?: string } = {};
  if (typeof body.enabled === "boolean") input.enabled = body.enabled;
  if (typeof body.idleMinutes === "number") input.idleMinutes = body.idleMinutes;
  if (typeof body.pin === "string") input.pin = body.pin;
  const lock = await updateLockSettings(input);
  broadcaster.emitEvent({ type: "settings" });
  return c.json(lock);
});

app.post("/api/lock/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pin?: unknown };
  const ok = typeof body.pin === "string" && (await verifyPin(body.pin));
  return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "Wrong PIN" }, 401);
});

/* ------------------------------------------------------------------ */
/* AI text transforms (selection ✨ / slash commands / chat rewrite)    */
/* ------------------------------------------------------------------ */

app.post("/api/ai/transform", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: unknown;
    text?: unknown;
    lang?: unknown;
  };
  const mode = TRANSFORM_MODES.includes(body.mode as TransformMode)
    ? (body.mode as TransformMode)
    : null;
  if (!mode || typeof body.text !== "string") {
    return c.json({ error: "Bad request" }, 400);
  }
  const text = body.text;
  const lang = typeof body.lang === "string" ? body.lang : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // client gone
        }
      };
      const clientAborted = c.req.raw.signal;
      try {
        await streamTransform({
          mode,
          text,
          lang,
          onDelta: (content) => send({ type: "delta", content }),
          onDone: () => send({ type: "done" }),
          onError: (message) => send({ type: "error", message }),
          signal: clientAborted,
        });
      } catch (err) {
        if (clientAborted.aborted) return;
        send({ type: "error", message: err instanceof Error ? err.message : "Transform failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

const EXPORT_MIME: Record<"pdf" | "docx", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function exportResponse(buffer: Buffer, filename: string, format: "pdf" | "docx"): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": EXPORT_MIME[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
}

app.post("/api/export/note", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as {
    path?: unknown;
    format?: unknown;
    content?: unknown;
  };
  if (typeof body.path !== "string" || !body.path) return c.json({ error: "Bad request" }, 400);
  const format = body.format === "pdf" || body.format === "docx" ? body.format : null;
  if (!format) return c.json({ error: "Bad request" }, 400);
  const { buffer, filename } = await exportNote(
    body.path,
    format,
    typeof body.content === "string" ? body.content : undefined,
  );
  return exportResponse(buffer, filename, format);
});

app.post("/api/export/tasks", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as {
    format?: unknown;
    project?: unknown;
  };
  const format = body.format === "pdf" || body.format === "docx" ? body.format : null;
  if (!format) return c.json({ error: "Bad request" }, 400);
  const { buffer, filename } = await exportTasks(format, typeof body.project === "string" && body.project ? body.project : null);
  return exportResponse(buffer, filename, format);
});

function pinRefFromBody(body: { type?: unknown; path?: unknown; id?: unknown }): { type: "file" | "task"; ref: string } | null {
  if (body.type !== "file" && body.type !== "task") return null;
  const ref = typeof body.path === "string" ? body.path : typeof body.id === "string" ? body.id : null;
  if (!ref) return null;
  return { type: body.type, ref };
}

app.get("/api/pins", async (c) => {
  if (!getWorkspace()) return c.json({ error: "Workspace not configured" }, 503);
  return c.json(await getPinboard());
});

app.post("/api/pins", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { type?: unknown; path?: unknown; id?: unknown };
  const target = pinRefFromBody(body);
  if (!target) return c.json({ error: "Bad request" }, 400);
  addPin(target.type, target.ref);
  broadcaster.emitEvent({ type: "pins" });
  return c.json({ ok: true });
});

app.delete("/api/pins", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { type?: unknown; path?: unknown; id?: unknown };
  const target = pinRefFromBody(body);
  if (!target) return c.json({ error: "Bad request" }, 400);
  removePin(target.type, target.ref);
  broadcaster.emitEvent({ type: "pins" });
  return c.json({ ok: true });
});

app.post("/api/chat/stream", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    messages?: { role: "user" | "assistant"; content: string; images?: string[] }[];
    contexts?: ContextTarget[];
  };
  if (!body.messages || body.messages.length === 0) {
    return c.json({ error: "Bad request" }, 400);
  }

  const messages = body.messages.map((m, i) => ({
    id: `m${i}`,
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
    images: m.images,
    createdAt: Date.now(),
  }));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // client already gone; stream closed
        }
      };
      const clientAborted = c.req.raw.signal;
      try {
        await streamChat({
          messages,
          contexts: body.contexts ?? [],
          onDelta: (text) => send({ type: "delta", content: text }),
          onDone: () => send({ type: "done" }),
          onError: (message) => send({ type: "error", message }),
          onTool: (name, status, detail) => send({ type: "tool", name, status, detail }),
          onCitations: (sources) => send({ type: "citations", sources }),
          signal: clientAborted,
        });
      } catch (err) {
        if (clientAborted.aborted) return;
        const message =
          err instanceof Error ? err.message : "Stream failed";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // streamChat is aborted via c.req.raw.signal; nothing else to clean up here.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.get("/api/events", (c) => {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const unsubscribe = broadcaster.subscribe((event) => {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        });
        const ping = setInterval(() => {
          controller.enqueue(new TextEncoder().encode(": ping\n\n"));
        }, 15000);
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(ping);
          unsubscribe();
          controller.close();
        });
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
});

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

app.use(
  "*",
  serveStatic({
    root: WEB_DIST,
    index: "index.html",
    onFound: (_path, c) => {
      // The HTML entry is un-hashed; without no-cache, browsers serve stale
      // bundles after a rebuild (stale UI, missing fixes).
      c.header("Cache-Control", "no-cache");
    },
  }),
);

app.use("*", async (c) => {
  const index = join(WEB_DIST, "index.html");
  try {
    const { readFile } = await import("node:fs/promises");
    return new Response(await readFile(index), {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return c.text("Persona web build not found. Run `npm run build:web`.", 404);
  }
});

const port = Number(process.env.PORT ?? 4321);
const host = process.env.HOST ?? "127.0.0.1";

ensureConfigDir();

function writePidFile() {
  try {
    writeFileSync(
      join(process.env.HOME ?? ".", ".persona", "server.pid"),
      String(process.pid),
      { flag: "w" },
    );
  } catch {
    // ignore
  }
}

function listenOnce(p: number): Promise<Awaited<ReturnType<typeof serve>>> {
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: p, hostname: host },
      (info) => {
        console.log(`Persona server listening on http://${host}:${info.port}`);
        writeState({ port: info.port, pid: process.pid, startedAt: Date.now() });
        writePidFile();
        startWatcher();
        void rebuildIndex();
        void loadSemanticIndex().then(() => {
          void rebuildSemanticIndex();
        });
        resolve(server);
      },
    );
    server.on("error", reject);
  });
}

async function startWithRetry(): Promise<Awaited<ReturnType<typeof serve>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await listenOnce(port);
    } catch (err) {
      lastErr = err;
      // Transient port race (e.g. two `persona` invocations) — retry briefly.
      if ((err as NodeJS.ErrnoException)?.code !== "EADDRINUSE" || attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

startWithRetry()
  .then((server) => {
    process.on("SIGTERM", () => {
      server.close();
      process.exit(0);
    });
    process.on("SIGINT", () => {
      server.close();
      process.exit(0);
    });
  })
  .catch((err) => {
    if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
      console.error(
        `Persona could not bind port ${port} — it is already in use by another process.`,
      );
      console.error(
        "If another Persona server is running, open it with `persona` instead. " +
          "Otherwise free the port and try again.",
      );
    } else {
      console.error("Persona server failed to start:", err);
    }
    process.exit(1);
  });
