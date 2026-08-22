import type {
  ChatMessage,
  ChatMeta,
  ChatSearchHit,
  ChatSource,
  ChatTranscript,
  ContextItem,
  ContextTarget,
  ImportPreview,
  ImportResult,
  ImportSource,
  LockSettings,
  ParsedTask,
  Pinboard,
  SearchResults,
  Settings,
  SettingsInput,
  TagSuggestResult,
  Task,
  TreeNode,
  TransformMode,
  TriageSuggestion,
} from "../../../src/shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** POST JSON to an endpoint that returns a file, then trigger a browser download. */
async function downloadExport(url: string, body: unknown, filename: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

export const api = {
  health: () => request<{ app: string }>("/api/health"),

  /** Transcribe a recorded audio blob (webm/ogg/mp4) with the local model. */
  transcribeAudio: (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, "audio.webm");
    return request<{ text: string }>("/api/stt/transcribe", {
      method: "POST",
      body: form,
    });
  },

  journalAppend: (text: string) =>
    request<{ ok: boolean }>("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  capture: (text: string) =>
    request<{ path: string }>("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  getSettings: () => request<Settings>("/api/settings"),
  saveSettings: (input: SettingsInput) =>
    request<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  pickFolder: () =>
    request<{ path: string | null }>("/api/pick-folder", { method: "POST" }),
  onboard: () =>
    request<{ created: string[] }>("/api/onboard", { method: "POST" }),

  tree: (root?: string) =>
    request<TreeNode[]>(`/api/fs/tree${root ? `?root=${encodeURIComponent(root)}` : ""}`),
  readFile: (path: string) =>
    request<{ content: string }>(`/api/fs/content?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) =>
    request<{ ok: boolean }>("/api/fs/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
  suggestTags: (path: string, content: string) =>
    request<TagSuggestResult>("/api/notes/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
  createEntry: (path: string, type: "file" | "folder") =>
    request<{ path: string }>("/api/fs/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, type }),
    }),
  renameEntry: (path: string, name: string) =>
    request<{ path: string }>("/api/fs/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name }),
    }),
  moveEntries: (paths: string[], target: string) =>
    request<{ paths: string[] }>("/api/fs/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, target }),
    }),
  duplicateEntry: (path: string) =>
    request<{ path: string }>("/api/fs/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  deleteEntry: (path: string) =>
    request<{ ok: boolean }>("/api/fs/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  search: (q: string, scope?: string) => {
    const params = new URLSearchParams({ q });
    if (scope) params.set("scope", scope);
    return request<SearchResults>(`/api/fs/search?${params}`);
  },
  reindex: () =>
    request<{ files: number; chunks: number }>("/api/ai/reindex", {
      method: "POST",
    }),
  context: (q: string) =>
    request<ContextItem[]>(`/api/fs/context?q=${encodeURIComponent(q)}`),

  tasks: () => request<Task[]>("/api/tasks"),
  parseTask: (text: string) =>
    request<ParsedTask>("/api/tasks/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  createTask: (text: string) =>
    request<Task>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  parseTasksBulk: (text: string) =>
    request<{ items: ParsedTask[] }>("/api/tasks/bulk/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  createTasksBulk: (text: string) =>
    request<{ tasks: Task[] }>("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  updateTask: (
    id: string,
    patch: Partial<Pick<Task, "title" | "status" | "priority" | "due" | "project" | "recur">>,
  ) =>
    request<Task>(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
  triageTasks: () =>
    request<{ suggestions: TriageSuggestion[] }>("/api/tasks/triage", {
      method: "POST",
    }),

  chats: () => request<ChatMeta[]>("/api/chats"),
  searchChats: (q: string) =>
    request<ChatSearchHit[]>(`/api/chats/search?q=${encodeURIComponent(q)}`),
  getChat: (id: string) => request<ChatTranscript>(`/api/chats/${id}`),
  saveChat: (id: string, title: string, messages: ChatMessage[]) =>
    request<ChatTranscript>(`/api/chats/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, messages }),
    }),
  deleteChat: (id: string) =>
    request<{ ok: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),

  getLock: () => request<LockSettings>("/api/lock"),
  saveLock: (input: { enabled?: boolean; idleMinutes?: number; pin?: string }) =>
    request<LockSettings>("/api/lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  verifyLock: (pin: string) =>
    request<{ ok: boolean }>("/api/lock/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    }),

  pins: () => request<Pinboard>("/api/pins"),
  pinFile: (path: string) =>
    request<{ ok: boolean }>("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "file", path }),
    }),
  unpinFile: (path: string) =>
    request<{ ok: boolean }>("/api/pins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "file", path }),
    }),
  pinTask: (id: string) =>
    request<{ ok: boolean }>("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "task", id }),
    }),
  unpinTask: (id: string) =>
    request<{ ok: boolean }>("/api/pins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "task", id }),
    }),

  exportNote: (path: string, format: "pdf" | "docx", content?: string) => {
    const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "note";
    return downloadExport("/api/export/note", { path, format, content }, `${name}.${format}`);
  },
  exportTasks: (format: "pdf" | "docx", project: string | null) => {
    const today = new Date().toISOString().slice(0, 10);
    const scope = project ? `-${project.replace(/[^a-z0-9-]+/gi, "-")}` : "";
    return downloadExport("/api/export/tasks", { format, project }, `tasks${scope}-${today}.${format}`);
  },

  enqueueChat: (chatId: string, content: string, contexts: ContextTarget[] = [], images?: string[]) =>
    request<{ chatId: string; userId: string; assistantId: string }>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, contexts, images }),
    }),
  cancelChatJob: (chatId: string, jobId: string) =>
    request<ChatMessage>(`/api/chats/${chatId}/jobs/${jobId}/cancel`, { method: "POST" }),
  retryChatJob: (chatId: string, jobId: string) =>
    request<ChatMessage>(`/api/chats/${chatId}/jobs/${jobId}/retry`, { method: "POST" }),

  importPreview: (source: ImportSource, path: string) =>
    request<ImportPreview>("/api/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, path }),
    }),
  importRun: (source: ImportSource, path: string) =>
    request<ImportResult>("/api/import/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, path }),
    }),
};

export type ChatStreamEvents =
  | { type: "delta"; content: string }
  | { type: "tool"; name: string; status: "start" | "done"; detail?: string }
  | { type: "citations"; sources: ChatSource[] }
  | { type: "done" }
  | { type: "error"; message: string };

export async function streamChat(
  messages: ChatMessage[],
  contexts: ContextTarget[],
  handlers: {
    onDelta: (content: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
    onTool?: (name: string, status: "start" | "done", detail?: string) => void;
    onCitations?: (sources: ChatSource[]) => void;
  },
  signal?: AbortSignal,
) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content, images: m.images })),
      contexts,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = res.statusText || "Chat request failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let terminated = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const event = JSON.parse(payload) as ChatStreamEvents;
      if (event.type === "delta") handlers.onDelta(event.content);
      else if (event.type === "tool") handlers.onTool?.(event.name, event.status, event.detail);
      else if (event.type === "citations") handlers.onCitations?.(event.sources);
      else if (event.type === "done") {
        handlers.onDone();
        finished = true;
        terminated = true;
        break;
      } else {
        handlers.onError(event.message);
        finished = true;
        terminated = true;
        break;
      }
    }
  }
  if (buffer) {
    const line = buffer.trim();
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload) {
        try {
          const event = JSON.parse(payload) as ChatStreamEvents;
          if (event.type === "delta") handlers.onDelta(event.content);
          else if (event.type === "tool") handlers.onTool?.(event.name, event.status, event.detail);
          else if (event.type === "citations") handlers.onCitations?.(event.sources);
          else if (event.type === "done") {
            handlers.onDone();
            terminated = true;
          } else {
            handlers.onError(event.message);
            terminated = true;
          }
        } catch {
          // incomplete frame at stream end
        }
      }
    }
  }
  if (!terminated) {
    handlers.onError("The connection was lost mid-response. Please try again.");
  }
}

export type TransformStreamEvents =
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Stream a one-shot AI text transformation (selection ✨ / slash / chat rewrite). */
export async function streamTransform(
  mode: TransformMode,
  text: string,
  handlers: {
    onDelta: (content: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
  opts?: { lang?: string; signal?: AbortSignal },
) {
  const res = await fetch("/api/ai/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, text, lang: opts?.lang }),
    signal: opts?.signal,
  });
  if (!res.ok || !res.body) {
    let message = res.statusText || "Transform failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const event = JSON.parse(payload) as TransformStreamEvents;
      if (event.type === "delta") handlers.onDelta(event.content);
      else if (event.type === "done") {
        handlers.onDone();
        terminated = true;
        break;
      } else {
        handlers.onError(event.message);
        terminated = true;
        break;
      }
    }
    if (terminated) break;
  }
  if (!terminated) handlers.onError("The connection was lost mid-transformation.");
}
