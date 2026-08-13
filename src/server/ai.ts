import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { format } from "date-fns";
import { getApiKey } from "./keychain.js";
import { readConfig } from "./state.js";
import { readFileContent, readTree } from "./fs.js";
import { listTasks } from "./tasks.js";
import { executeTool, toolDefs } from "./tools.js";
import { detectOllama, invalidateOllamaCache } from "./ollama.js";
import { semanticSearch } from "./embeddings.js";
import type { ChatMessage, ChatSource, ContextTarget, ChatBackend, LocalAiInfo } from "../shared/types.js";

export interface AiConfig {
  provider: string;
  baseUrl: string;
  model: string;
  /** True when the endpoint came from local auto-detection, not user config. */
  local: boolean;
  /** The user's explicit chat backend choice from settings. */
  backend: ChatBackend;
  /** True when a local Ollama was actually detected and reachable. */
  localDetected: boolean;
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

const DEFAULT_REMOTE = {
  provider: "OpenAI-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
} as const;

/** Pick the user's chosen local model when it's still installed, else auto. */
function resolveLocalModel(local: LocalAiInfo | null, preferred?: string): string {
  if (preferred && local?.models?.includes(preferred)) return preferred;
  return local?.model ?? "";
}

/**
 * Resolve the effective AI endpoint. The user's explicit backend choice
 * ("local" = Ollama only, "cloud" = API key only) is honored; "auto" keeps the
 * old behaviour: an explicitly configured base URL wins, then a running local
 * Ollama, then the OpenAI defaults.
 */
export async function resolveAiConfig(): Promise<AiConfig> {
  const config = readConfig();
  const backend = config.ai?.backend ?? "auto";
  const local = await detectOllama();
  const localDetected = Boolean(local);

  if (backend === "local") {
    if (local) {
      return {
        provider: local.name,
        baseUrl: local.baseUrl,
        model: resolveLocalModel(local, config.ai?.ollamaModel),
        local: true,
        backend,
        localDetected,
      };
    }
    return { provider: "Ollama", baseUrl: "", model: "", local: true, backend, localDetected };
  }

  if (config.ai?.baseUrl) {
    return {
      provider: config.ai.provider || "OpenAI-compatible",
      baseUrl: config.ai.baseUrl,
      model: config.ai.model || DEFAULT_REMOTE.model,
      local: false,
      backend,
      localDetected,
    };
  }

  // "cloud" never falls back to a local model; "auto" prefers one when found.
  if (backend !== "cloud" && local) {
    return {
      provider: local.name,
      baseUrl: local.baseUrl,
      model: resolveLocalModel(local, config.ai?.ollamaModel),
      local: true,
      backend,
      localDetected,
    };
  }
  return { ...DEFAULT_REMOTE, local: false, backend, localDetected };
}

export async function resolveContext(targets: ContextTarget[]): Promise<string> {
  const blocks: string[] = [];
  for (const target of targets) {
    try {
      if (target.type === "file") {
        const content = await readFileContent(target.path);
        blocks.push(`<file path="${target.path}">\n${content}\n</file>`);
      } else if (target.type === "folder") {
        const tree = await readTree(target.path);
        const names = tree.map((n) => `${n.type === "folder" ? "dir" : "file"} ${n.path}`).join("\n");
        blocks.push(`<folder path="${target.path}/">\n${names}\n</folder>`);
      } else if (target.type === "tasks") {
        const tasks = await listTasks();
        const lines = tasks.map(
          (t) =>
            `- [${t.status === "done" ? "x" : " "}] ${t.title}` +
            (t.due ? ` (due ${t.due})` : "") +
            (t.priority !== "medium" ? ` [${t.priority}]` : "") +
            (t.project ? ` #${t.project}` : ""),
        );
        blocks.push(`<tasks>\n${lines.join("\n") || "(no tasks)"}\n</tasks>`);
      }
    } catch {
      blocks.push(`<error>Could not load context: ${target.path}</error>`);
    }
  }
  return blocks.join("\n\n");
}

const SYSTEM_PROMPT = `You are Persona, an AI assistant for the user's local, file-based personal workspace. You can read every note, project and task stored as plain files on the user's machine, and you can create, edit and organize them on the user's behalf.

Rules:
- Be concise. Prefer short answers, bullet lists, and direct language.
- When files or tasks are attached as context, use them; otherwise say so.
- When notes found by workspace search are attached, answer from them if they address the question, and name the file you drew from.
- To find a file, call list_folder once — it returns the full tree including all subfolders. Then read the file with read_note and answer. Do not call list_folder repeatedly on the same or nested folders; if the file does not exist, say so and stop.
- You may quote from the user's files, but do not invent content that is not present.
- You can do anything with notes, folders and tasks: create, edit, append, move, rename and delete files and folders; create, complete, update and delete tasks. When the user asks for a multi-step outcome, do it in one go — don't stop to ask permission between steps.
- Batch tool calls: when several tool calls are independent, make them ALL in the same response — the system executes them together and returns every result at once. Only wait for results when a later call depends on an earlier one (e.g. list_tasks before update_task).
- To modify or delete a task, first call list_tasks to get its id.
- Only delete a file or folder when the user's latest message clearly asks for it; otherwise offer to do it instead of doing it.
- Before overwriting an existing file with substantial content, briefly confirm what you will change.
- Never delete or modify anything inside .persona (tasks are stored there — use the task tools instead of touching those files directly).
- When the user pastes a screenshot or image, describe it or extract its text verbatim when asked; if you cannot see the image, say so.
- Distinguish direct citations from inference. Say "your notes explicitly say X" only when the source states it directly; otherwise say "these entries appear related but aren't explicitly connected". Never present an inferred link as confirmed fact.
- When you use a tool, mention what you did in one short line.`;

export interface StreamOptions {
  messages: ChatMessage[];
  contexts: ContextTarget[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onTool?: (name: string, status: "start" | "done", detail?: string) => void;
  onCitations?: (sources: ChatSource[]) => void;
  signal?: AbortSignal;
}

const MAX_TOOL_ROUNDS = 24;

function toApiMessage(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "user" && m.images && m.images.length > 0) {
    return {
      role: "user",
      content: [
        { type: "text", text: m.content },
        ...m.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    };
  }
  return { role: m.role, content: m.content };
}

function errorMessage(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 400) {
      const detail = err.message.replace(/^\s*\d+\s+/, "");
      return `The provider rejected the request (the configured model may not support images): ${detail}`;
    }
    if (err.status === 401) return "Invalid API key — check Settings → AI.";
  }
  return err instanceof Error ? err.message : "Unknown error";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanCandidate(s: string): string {
  return s
    .replace(/^[\s*_`"“”'‘’(\[]+/, "")
    .replace(/[\s*_`"“”'‘’)\].!?,:;…-]+$/, "")
    .trim();
}

/**
 * Find the 1-based line in `content` that the answer quotes. Candidates are
 * lines and sentences from the answer (longest first); each is searched as
 * progressively smaller word windows with whitespace made flexible, so the
 * quote still matches when the model frames it with its own words.
 */
function findCitedLine(content: string, answer: string): number | null {
  const candidates = new Set<string>();
  for (const line of answer.split(/\n+/)) {
    const c = cleanCandidate(line);
    if (c.length >= 24) candidates.add(c);
  }
  for (const sentence of answer.split(/(?<=[.!?…])\s+/)) {
    const c = cleanCandidate(sentence);
    if (c.length >= 24) candidates.add(c);
  }
  const seen = new Set<string>();
  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  for (const candidate of ordered) {
    const words = candidate
      .split(" ")
      .map((w) => w.replace(/^[^\w]+/, "").replace(/[^\w]+$/, ""))
      .filter(Boolean);
    const maxLen = Math.min(words.length, 12);
    for (let len = maxLen; len >= 4; len--) {
      for (let start = 0; start + len <= words.length; start++) {
        const probe = words.slice(start, start + len).join(" ");
        if (seen.has(probe)) continue;
        seen.add(probe);
        const re = new RegExp(escapeRegExp(probe).replace(/\s+/g, "\\s+"), "i");
        const m = re.exec(content);
        if (m) return content.slice(0, m.index).split("\n").length;
      }
    }
  }
  return null;
}

function computeCitations(answer: string, sources: Map<string, string>): ChatSource[] {
  const citations: ChatSource[] = [];
  for (const [path, content] of sources) {
    citations.push({ path, line: findCitedLine(content, answer) ?? 1 });
  }
  return citations;
}

export async function streamChat(options: StreamOptions): Promise<void> {
  let apiKey = await getApiKey();
  const { baseUrl, model, local, backend, localDetected } = await resolveAiConfig();
  if (backend === "local" && !localDetected) {
    options.onError(
      "Ollama is not running. Start it, or switch the chat backend in Settings → AI.",
    );
    return;
  }
  if (local && !model) {
    options.onError(
      "Ollama is running but has no models installed. Pull one first, e.g. `ollama pull llama3.2`.",
    );
    return;
  }
  const usingLocal = local || isLocalEndpoint(baseUrl);
  if (!apiKey) {
    if (usingLocal) {
      // Ollama's OpenAI-compatible API accepts any key — no setup required.
      apiKey = "ollama";
    } else {
      options.onError("No API key configured. Open Settings to add one.");
      return;
    }
  }

  // Notes the assistant may draw on — cached so citations can be matched
  // against exactly what the model saw.
  const sources = new Map<string, string>();
  for (const target of options.contexts) {
    if (target.type !== "file") continue;
    try {
      sources.set(target.path, await readFileContent(target.path));
    } catch {
      // unreadable context file — skip
    }
  }

  let contextBlock = "";
  if (options.contexts.length > 0) {
    contextBlock = await resolveContext(options.contexts);
  }

  // Nothing was attached explicitly — search the user's notes semantically and
  // pull in the most relevant chunks, so the assistant can answer from the
  // user's actual writing ("that thing I wrote about camping").
  const lastUser = [...options.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (options.contexts.length === 0 && lastUser.trim()) {
    try {
      const hits = await semanticSearch(lastUser, 3, true);
      if (hits.length > 0) {
        const blocks = hits.map((h) => `<file path="${h.path}">\n${h.snippet}\n</file>`);
        contextBlock = `The following notes were found by searching the workspace. Use them if they answer the question:\n${blocks.join("\n\n")}`;
        for (const h of hits) sources.set(h.path, h.snippet);
      }
    } catch {
      // semantic search unavailable (no key / no index) — proceed without it
    }
  }

  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  const today = format(new Date(), "EEEE, yyyy-MM-dd");

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        `\n\nToday's date is ${today}. Use it as the current date when answering questions about due dates, overdue tasks, or day counts.` +
        (contextBlock ? `\n\nThe following context is attached to this conversation:\n${contextBlock}` : ""),
    },
    ...options.messages.slice(-24).map(toApiMessage),
  ];

  let useTools = true;
  let fullText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let stream: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      stream = await client.chat.completions.create(
        { model, stream: true, messages, tools: useTools ? toolDefs : undefined },
        { signal: options.signal },
      );
    } catch (err) {
      if (options.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw err;
      }
      // Some providers (e.g. Ollama) don't support tools — fall back to plain chat.
      if (useTools && !(err instanceof OpenAI.APIError && err.status === 401)) {
        useTools = false;
        round--;
        continue;
      }
      if (usingLocal) {
        invalidateOllamaCache();
        throw new Error(
          `Could not reach the local model server at ${baseUrl}. Is it still running?`,
        );
      }
      throw new Error(errorMessage(err));
    }

    let text = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        fullText += delta.content;
        options.onDelta(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const existing = calls.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          calls.set(idx, existing);
        }
      }
    }

    if (calls.size === 0) {
      if (sources.size > 0 && fullText.trim().length > 0) {
        options.onCitations?.(computeCitations(fullText, sources));
      }
      options.onDone();
      return;
    }

    const toolCalls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c], i) => ({
        // Some providers omit the call id in streaming mode — synthesize a
        // stable one so the tool result can be matched back.
        id: c.id || `call_${Date.now()}_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      }));

    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let result: string;
      try {
        options.onTool?.(call.function.name, "start");
        const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        result = await executeTool(call.function.name, args);
        if (call.function.name === "read_note" && typeof args.path === "string" && args.path) {
          sources.set(args.path, result);
        }
        options.onTool?.(call.function.name, "done", result);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : "tool failed"}`;
        options.onTool?.(call.function.name, "done", result);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  options.onError("Too many tool rounds — please try again.");
}
