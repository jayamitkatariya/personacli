import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { format } from "date-fns";
import { getApiKey, getProfileApiKey } from "./keychain.js";
import { isLocalEndpoint, resolveAiConfig, resolveContext, runAgenticLoop } from "./ai.js";
import { getChat, saveChat } from "./chats.js";
import { readConfig } from "./state.js";
import { broadcaster } from "./watcher.js";
import type { ChatMessage, ChatSource, ChatToolStep, ContextTarget } from "../shared/types.js";

type QueueItem = {
  userMessage: ChatMessage;
  assistantId: string;
  contexts: ContextTarget[];
};

type ChatQueueState = {
  chatId: string;
  pending: QueueItem[];
  runningId: string | null;
  controller: AbortController | null;
};

const queues = new Map<string, ChatQueueState>();
const MAX_CONCURRENT = 2;
let activeRuns = 0;

function getOrCreateQueue(chatId: string): ChatQueueState {
  const existing = queues.get(chatId);
  if (existing) return existing;
  const next: ChatQueueState = { chatId, pending: [], runningId: null, controller: null };
  queues.set(chatId, next);
  return next;
}

function availableKey(apiKey: string | null, local: boolean, baseUrl: string): string | null {
  if (apiKey) return apiKey;
  if (local || isLocalEndpoint(baseUrl)) return "ollama";
  return null;
}

function newMessageId(prefix: "u" | "a"): string {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

async function persistChatUpdate(chatId: string, updater: (messages: ChatMessage[]) => ChatMessage[]): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const nextMessages = updater(chat.messages);
  await saveChat(chatId, { title: chat.title, messages: nextMessages });
  broadcaster.emitEvent({ type: "chats" });
}

async function runChatWithFallback(
  baseMessages: ChatCompletionMessageParam[],
  sources: Map<string, string>,
  signal: AbortSignal,
  onDelta: (t: string) => void,
  onTool: (name: string, status: "start" | "done", detail?: string) => void | Promise<void>,
  onCitations: (sources: ChatSource[]) => void,
): Promise<{ text: string; sources: ChatSource[]; modelLabel?: string }> {
  const config = readConfig();
  const profiles = config.ai?.profiles ?? [];
  const defaultId = config.ai?.defaultModelId ?? null;
  const backupId = config.ai?.backupModelId ?? null;
  const primaryConfig = await resolveAiConfig();
  const primaryKey = await getApiKey();
  const primaryLocal = primaryConfig.local;
  const primaryBaseUrl = primaryConfig.baseUrl;
  const primaryModel = primaryConfig.model;
  const primaryAvailable = availableKey(primaryKey, primaryLocal, primaryBaseUrl);

  const attempts: Array<{ label: string; baseUrl: string; model: string; provider: string; key: string | null; local: boolean }> = [];

  if (defaultId) {
    const def = profiles.find((p) => p.id === defaultId);
    if (def) {
      const key = await getProfileApiKey(def.id);
      attempts.push({ label: def.label, baseUrl: def.baseUrl ?? primaryBaseUrl, model: def.model ?? primaryModel, provider: def.provider ?? primaryConfig.provider, key, local: isLocalEndpoint(def.baseUrl ?? primaryBaseUrl) });
    }
  }
  if (primaryAvailable) {
    attempts.push({ label: `${primaryConfig.provider} ${primaryModel}`.trim(), baseUrl: primaryBaseUrl, model: primaryModel, provider: primaryConfig.provider, key: primaryAvailable, local: primaryLocal });
  }
  if (backupId && backupId !== defaultId) {
    const back = profiles.find((p) => p.id === backupId);
    if (back) {
      const key = await getProfileApiKey(back.id);
      attempts.push({ label: back.label, baseUrl: back.baseUrl ?? primaryBaseUrl, model: back.model ?? primaryModel, provider: back.provider ?? primaryConfig.provider, key, local: isLocalEndpoint(back.baseUrl ?? primaryBaseUrl) });
    }
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const key = attempt.key ?? (attempt.local || isLocalEndpoint(attempt.baseUrl) ? "ollama" : null);
    if (!key) continue;
    try {
      const client = new OpenAI({ apiKey: key, baseURL: attempt.baseUrl });
      const result = await runAgenticLoop({
        client,
        model: attempt.model,
        baseUrl: attempt.baseUrl,
        usingLocal: attempt.local,
        messages: [...baseMessages],
        sources,
        onDelta,
        onTool,
        onCitations,
        signal,
      });
      return { ...result, modelLabel: attempt.label };
    } catch (err) {
      lastError = err;
      if (signal.aborted) throw err;
      continue;
    }
  }
  throw lastError ?? new Error("No AI provider configured. Add models in Settings.");
}

export async function enqueueChatMessage(
  chatId: string | null,
  content: string,
  contexts: ContextTarget[] = [],
  images?: string[],
): Promise<{ chatId: string; userId: string; assistantId: string }> {
  let id = chatId;
  if (!id) {
    id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  let chat = await getChat(id);
  if (!chat) {
    chat = await saveChat(id, { title: content.slice(0, 60) || "Untitled chat", messages: [] });
  }
  const userId = newMessageId("u");
  const assistantId = newMessageId("a");
  const userMessage: ChatMessage = {
    id: userId,
    role: "user",
    content,
    contexts: contexts.length ? contexts : undefined,
    images: images?.length ? images : undefined,
    createdAt: Date.now(),
  };
  const assistantMessage: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    status: "queued",
    steps: [],
    error: null,
  };
  await saveChat(id, { title: chat.title, messages: [...chat.messages, userMessage, assistantMessage] });
  broadcaster.emitEvent({ type: "chats" });

  const queue = getOrCreateQueue(id);
  queue.pending.push({ userMessage, assistantId, contexts });
  void processChatQueue(id);
  return { chatId: id, userId, assistantId };
}

async function processChatQueue(chatId: string): Promise<void> {
  const queue = getOrCreateQueue(chatId);
  if (queue.runningId) return;
  if (activeRuns >= MAX_CONCURRENT) return;
  const next = queue.pending.shift();
  if (!next) return;

  queue.runningId = next.assistantId;
  queue.controller = new AbortController();
  activeRuns++;

  await persistChatUpdate(chatId, (messages) =>
    messages.map((m) => (m.id === next.assistantId ? { ...m, status: "streaming" as const } : m)),
  );

  const chat = await getChat(chatId);
  if (!chat) {
    queue.runningId = null;
    queue.controller = null;
    activeRuns--;
    return;
  }

  const today = format(new Date(), "EEEE, yyyy-MM-dd");
  let contextBlock = "";
  try {
    if (next.contexts.length > 0) contextBlock = await resolveContext(next.contexts);
  } catch {
    contextBlock = "";
  }

  const transcript = chat.messages;
  const messagesForModel: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are Persona, an AI assistant for the user's local workspace.` +
        `\n\nToday's date is ${today}.` +
        (contextBlock ? `\n\nContext:\n${contextBlock}` : ""),
    },
    ...transcript
      .filter((m) => m.id !== next.assistantId)
      .slice(-24)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })) as ChatCompletionMessageParam[],
  ];

  const sources = new Map<string, string>();
  let pendingDelta = "";
  let lastPersist = 0;

  const flushDelta = async () => {
    if (!pendingDelta) return;
    const delta = pendingDelta;
    pendingDelta = "";
    await persistChatUpdate(chatId, (messages) =>
      messages.map((m) => (m.id === next.assistantId ? { ...m, content: (m.content ?? "") + delta } : m)),
    );
  };

  try {
    const { text } = await runChatWithFallback(
      messagesForModel,
      sources,
      queue.controller.signal,
      (delta) => {
        pendingDelta += delta;
        const now = Date.now();
        if (now - lastPersist > 300) {
          lastPersist = now;
          void flushDelta();
        }
      },
      async (name, status, detail) => {
        await flushDelta();
        await persistChatUpdate(chatId, (messages) =>
          messages.map((m) => {
            if (m.id !== next.assistantId) return m;
            const steps: ChatToolStep[] = [...(m.steps ?? [])];
            const step: ChatToolStep = { name, status, detail, at: Date.now() };
            if (status === "done") {
              const idx = [...steps].reverse().findIndex((s) => s.name === name && s.status === "start");
              if (idx !== -1) {
                const target = steps.length - 1 - idx;
                steps[target] = step;
              } else steps.push(step);
            } else steps.push(step);
            return { ...m, steps };
          }),
        );
      },
      async (citations) => {
        await flushDelta();
        await persistChatUpdate(chatId, (messages) =>
          messages.map((m) => (m.id === next.assistantId ? { ...m, sources: citations } : m)),
        );
      },
    );
    await flushDelta();
    await persistChatUpdate(chatId, (messages) =>
      messages.map((m) => (m.id === next.assistantId ? { ...m, content: text || m.content, status: "done" as const, error: null } : m)),
    );
  } catch (err) {
    const aborted = queue.controller?.signal.aborted;
    await flushDelta();
    await persistChatUpdate(chatId, (messages) =>
      messages.map((m) => {
        if (m.id !== next.assistantId) return m;
        if (aborted) return { ...m, status: "cancelled" as const, error: null };
        return { ...m, status: "failed" as const, error: err instanceof Error ? err.message : "Chat failed" };
      }),
    );
  } finally {
    queue.runningId = null;
    queue.controller = null;
    activeRuns = Math.max(0, activeRuns - 1);
    if (queue.pending.length > 0) void processChatQueue(chatId);
    for (const [otherId, otherQueue] of queues) {
      if (otherId !== chatId && otherQueue.pending.length > 0 && !otherQueue.runningId) void processChatQueue(otherId);
    }
  }
}

export async function cancelChatJob(chatId: string, assistantId: string): Promise<ChatMessage | null> {
  const queue = queues.get(chatId);
  if (queue?.runningId === assistantId) queue.controller?.abort();
  const chat = await getChat(chatId);
  if (!chat) return null;
  const msg = chat.messages.find((m) => m.id === assistantId) ?? null;
  if (!msg) return null;
  if (msg.status === "queued") {
    const idx = queue?.pending.findIndex((p) => p.assistantId === assistantId) ?? -1;
    if (idx !== -1) queue!.pending.splice(idx, 1);
    await persistChatUpdate(chatId, (messages) => messages.map((m) => (m.id === assistantId ? { ...m, status: "cancelled" as const, error: null } : m)));
    const updated = await getChat(chatId);
    return updated?.messages.find((m) => m.id === assistantId) ?? null;
  }
  return msg;
}

export async function retryChatJob(chatId: string, assistantId: string): Promise<ChatMessage | null> {
  const chat = await getChat(chatId);
  if (!chat) return null;
  const idx = chat.messages.findIndex((m) => m.id === assistantId);
  if (idx === -1) return null;
  const assistantMsg = chat.messages[idx]!;
  if (assistantMsg.role !== "assistant" || assistantMsg.status === "streaming" || assistantMsg.status === "queued") return assistantMsg;
  const userMsg = [...chat.messages.slice(0, idx)].reverse().find((m) => m.role === "user") ?? null;
  if (!userMsg) return null;
  await persistChatUpdate(chatId, (messages) =>
    messages.map((m) => (m.id === assistantId ? { ...m, content: "", status: "queued" as const, error: null, steps: [] } : m)),
  );
  const queue = getOrCreateQueue(chatId);
  queue.pending.push({ userMessage: userMsg, assistantId, contexts: userMsg.contexts ?? [] });
  void processChatQueue(chatId);
  const updated = await getChat(chatId);
  return updated?.messages.find((m) => m.id === assistantId) ?? null;
}

export async function reconcileInterruptedChatJobs(): Promise<void> {
  const { listChats } = await import("./chats.js");
  const chats = await listChats().catch(() => []);
  for (const meta of chats) {
    const chat = await getChat(meta.id).catch(() => null);
    if (!chat) continue;
    let changed = false;
    const nextMessages = chat.messages.map((m) => {
      if (m.role === "assistant" && m.status === "streaming") {
        changed = true;
        return { ...m, status: "failed" as const, error: "Interrupted by server restart" };
      }
      return m;
    });
    if (changed) await saveChat(chat.id, { title: chat.title, messages: nextMessages }).catch(() => {});
  }
}

export function getChatQueue(chatId: string): ChatQueueState | null {
  return queues.get(chatId) ?? null;
}
