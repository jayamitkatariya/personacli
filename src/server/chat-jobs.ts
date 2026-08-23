import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { format } from "date-fns";
import { getApiKey, getProfileApiKey } from "./keychain.js";
import { isLocalEndpoint, resolveAiConfig, resolveContext, runAgenticLoop } from "./ai.js";
import { listPersonas } from "./personas.js";
import { getChat, saveChat } from "./chats.js";
import { readConfig } from "./state.js";
import { broadcaster } from "./watcher.js";
import type { ChatMessage, ChatSource, ChatToolStep, ChatTranscript, ContextTarget } from "../shared/types.js";

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
  /** Live approval requests awaiting the user's decision. */
  approvals: Map<string, { resolve: (ok: boolean) => void }>;
};

const queues = new Map<string, ChatQueueState>();
const MAX_CONCURRENT = 2;
let activeRuns = 0;

function newApprovalId(): string {
  return `ap${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

const APPROVAL_ARG_LIMIT = 400;

/** Conversation-history budget in characters (~4 chars/token → ~24k tokens). */
export const HISTORY_CHAR_BUDGET = 96_000;

/** Rough per-message cost; images count their base64 payload at ~3/4 scale. */
function estimateMessageChars(m: ChatMessage): number {
  let cost = m.content.length + 12;
  if (m.images) {
    for (const data of m.images) cost += Math.ceil(data.length * 0.75);
  }
  return cost;
}

/**
 * Keep as many recent messages as fit the budget (the newest always stays,
 * however large). Older messages become the evicted tail that gets summarized.
 */
export function selectHistory(messages: ChatMessage[]): { kept: ChatMessage[]; evicted: ChatMessage[] } {
  let total = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageChars(messages[i]!);
    if (i < messages.length - 1 && total + cost > HISTORY_CHAR_BUDGET) break;
    total += cost;
    cut = i;
  }
  return { kept: messages.slice(cut), evicted: messages.slice(0, cut) };
}

type SummaryCacheEntry = { coveredIds: string[]; text: string };
const summaryCache = new Map<string, SummaryCacheEntry>();

/**
 * Summarize the evicted head of a conversation so long chats keep continuity
 * without blowing the model's context window. Cached until the evicted set
 * grows or changes shape; best-effort — failures return the previous summary.
 */
async function summarizeEvicted(chatId: string, evicted: ChatMessage[], signal?: AbortSignal): Promise<string> {
  if (evicted.length === 0) return "";
  const ids = evicted.map((m) => m.id);
  const cached = summaryCache.get(chatId);
  if (
    cached &&
    cached.coveredIds.length === ids.length &&
    cached.coveredIds.every((id, i) => id === ids[i])
  ) {
    return cached.text;
  }
  try {
    const config = await resolveAiConfig();
    const key = availableKey(await getApiKey(), config.local, config.baseUrl);
    if (!key || !config.model) return cached?.text ?? "";
    const client = new OpenAI({ apiKey: key, baseURL: config.baseUrl });
    const transcript = evicted
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 4000)}`)
      .join("\n\n")
      .slice(-32_000);
    const res = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "Summarize this ongoing conversation between a user and their AI assistant in under 150 words. Capture topics discussed, decisions made, facts learned, and any open threads so the conversation can continue seamlessly. Output only the summary.",
          },
          { role: "user", content: transcript },
        ],
        max_tokens: 320,
      },
      { signal },
    );
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    if (!text) return cached?.text ?? "";
    summaryCache.set(chatId, { coveredIds: ids, text });
    return text;
  } catch {
    return cached?.text ?? "";
  }
}

/**
 * After the first assistant reply, replace the 60-char stub title with a
 * short AI-generated one (fire-and-forget, best-effort).
 */
async function maybeAutoTitle(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  if (chat.messages.length < 2) return;
  const firstUser = chat.messages.find((m) => m.role === "user")?.content?.trim();
  if (!firstUser) return;
  const stub = firstUser.slice(0, 60);
  if (chat.title !== stub && chat.title !== "Untitled chat") return;
  try {
    const config = await resolveAiConfig();
    const key = availableKey(await getApiKey(), config.local, config.baseUrl);
    if (!key || !config.model) return;
    const client = new OpenAI({ apiKey: key, baseURL: config.baseUrl });
    const transcript = chat.messages
      .slice(0, 4)
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n");
    const res = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "Generate a concise 3-6 word title for this conversation. Output only the title, no quotes.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 16,
    });
    const title = res.choices[0]?.message?.content?.trim()?.replace(/^["']|["']$/g, "")?.slice(0, 60);
    if (title && title.length >= 3 && title !== chat.title) {
      const fresh = await getChat(chatId);
      if (!fresh) return;
      const freshStub = fresh.messages.find((m) => m.role === "user")?.content?.trim()?.slice(0, 60);
      if (fresh.title !== freshStub && fresh.title !== "Untitled chat") return;
      if (title === fresh.title) return;
      await saveChat(chatId, { title, messages: fresh.messages });
      broadcaster.emitEvent({ type: "chats" });
    }
  } catch {
    // title generation is best-effort
  }
}

function getOrCreateQueue(chatId: string): ChatQueueState {
  const existing = queues.get(chatId);
  if (existing) return existing;
  const next: ChatQueueState = {
    chatId,
    pending: [],
    runningId: null,
    controller: null,
    approvals: new Map(),
  };
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
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void,
  overrideModelId?: string | null,
  temperature?: number,
  requestApproval?: (tool: string, args: Record<string, unknown>) => Promise<boolean>,
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

  // A per-chat model override takes precedence over every global choice.
  if (overrideModelId) {
    const prof = profiles.find((p) => p.id === overrideModelId);
    if (prof) {
      const key = await getProfileApiKey(prof.id);
      attempts.push({ label: prof.label, baseUrl: prof.baseUrl ?? primaryBaseUrl, model: prof.model ?? primaryModel, provider: prof.provider ?? primaryConfig.provider, key, local: isLocalEndpoint(prof.baseUrl ?? primaryBaseUrl) });
    }
  }
  if (defaultId && defaultId !== overrideModelId) {
    const def = profiles.find((p) => p.id === defaultId);
    if (def) {
      const key = await getProfileApiKey(def.id);
      attempts.push({ label: def.label, baseUrl: def.baseUrl ?? primaryBaseUrl, model: def.model ?? primaryModel, provider: def.provider ?? primaryConfig.provider, key, local: isLocalEndpoint(def.baseUrl ?? primaryBaseUrl) });
    }
  }
  if (primaryAvailable) {
    attempts.push({ label: `${primaryConfig.provider} ${primaryModel}`.trim(), baseUrl: primaryBaseUrl, model: primaryModel, provider: primaryConfig.provider, key: primaryAvailable, local: primaryLocal });
  }
  if (backupId && backupId !== defaultId && backupId !== overrideModelId) {
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
        onUsage,
        requestApproval,
        signal,
        temperature,
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

  const transcriptAll = chat.messages.filter((m) => m.id !== next.assistantId);
  const { kept, evicted } = selectHistory(transcriptAll);
  let summaryBlock = "";
  if (evicted.length > 0) {
    const summary = await summarizeEvicted(chatId, evicted, queue.controller.signal);
    if (summary) {
      summaryBlock =
        `\n\nEarlier in this conversation (summarized for continuity):\n` +
        `<conversation_summary>\n${summary}\n</conversation_summary>`;
    }
  }
  // Per-chat persona: an extra system-prompt block from .persona/personas.
  let personaBlock = "";
  if (chat.personaId) {
    const persona = await listPersonas().then((all) => all.find((p) => p.id === chat.personaId)).catch(() => undefined);
    if (persona?.prompt) personaBlock = `\n\n${persona.prompt}`;
  }
  const messagesForModel: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are Persona, an AI assistant for the user's local workspace.` +
        personaBlock +
        `\n\nToday's date is ${today}.` +
        (contextBlock ? `\n\nContext:\n${contextBlock}` : "") +
        summaryBlock,
    },
    ...kept.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })) as ChatCompletionMessageParam[],
  ];

  const usageTotals = { promptTokens: 0, completionTokens: 0 };
  const toolApproval = readConfig().ai?.toolApproval ?? "ask";

  const sources = new Map<string, string>();
  let pendingDelta = "";
  let lastPersist = 0;

  // Only destructive tools ask — auto mode skips the whole waiter.
  const requestApprovalForJob =
    toolApproval === "auto"
      ? undefined
      : async (tool: string, args: Record<string, unknown>): Promise<boolean> => {
          const controller = queue.controller;
          if (!controller || controller.signal.aborted) return false;
          const approvalId = newApprovalId();
          const trimmedArgs: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(args)) {
            trimmedArgs[k] =
              typeof v === "string" && v.length > APPROVAL_ARG_LIMIT
                ? v.slice(0, APPROVAL_ARG_LIMIT) + `… (+${v.length - APPROVAL_ARG_LIMIT} chars)`
                : v;
          }
          await flushDelta();
          let resolveFn!: (ok: boolean) => void;
          const promise = new Promise<boolean>((res) => {
            resolveFn = res;
          });
          queue.approvals.set(approvalId, { resolve: resolveFn });
          const onAbort = () => resolveFn(false);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          await persistChatUpdate(chatId, (messages) =>
            messages.map((m) =>
              m.id === next.assistantId ? { ...m, pendingApproval: { id: approvalId, tool, args: trimmedArgs } } : m,
            ),
          );
          try {
            return await promise;
          } finally {
            controller.signal.removeEventListener("abort", onAbort);
            queue.approvals.delete(approvalId);
            await persistChatUpdate(chatId, (messages) =>
              messages.map((m) =>
                m.id === next.assistantId ? { ...m, pendingApproval: null } : m,
              ),
            );
          }
        };

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
      (usage) => {
        usageTotals.promptTokens += usage.promptTokens;
        usageTotals.completionTokens += usage.completionTokens;
      },
      chat.modelId ?? null,
      chat.temperature ?? undefined,
      requestApprovalForJob,
    );
    await flushDelta();
    const hasUsage = usageTotals.promptTokens > 0 || usageTotals.completionTokens > 0;
    await persistChatUpdate(chatId, (messages) =>
      messages.map((m) =>
        m.id === next.assistantId
          ? {
              ...m,
              content: text || m.content,
              status: "done" as const,
              error: null,
              pendingApproval: null,
              ...(hasUsage ? { usage: { ...usageTotals } } : null),
            }
          : m,
      ),
    );
    void maybeAutoTitle(chatId);
  } catch (err) {
    const aborted = queue.controller?.signal.aborted;
    await flushDelta();
    await persistChatUpdate(chatId, (messages) =>
      messages.map((m) => {
        if (m.id !== next.assistantId) return m;
        if (aborted) return { ...m, status: "cancelled" as const, error: null, pendingApproval: null };
        return { ...m, status: "failed" as const, error: err instanceof Error ? err.message : "Chat failed", pendingApproval: null };
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
    messages.map((m) =>
      m.id === assistantId ? { ...m, content: "", status: "queued" as const, error: null, steps: [], pendingApproval: null } : m,
    ),
  );
  const queue = getOrCreateQueue(chatId);
  queue.pending.push({ userMessage: userMsg, assistantId, contexts: userMsg.contexts ?? [] });
  void processChatQueue(chatId);
  const updated = await getChat(chatId);
  return updated?.messages.find((m) => m.id === assistantId) ?? null;
}

export async function resolveChatApproval(
  chatId: string,
  approvalId: string,
  approve: boolean,
): Promise<ChatMessage | null> {
  const queue = queues.get(chatId);
  if (!queue) return null;
  const waiter = queue.approvals.get(approvalId);
  if (!waiter) return null;
  waiter.resolve(approve);
  // Return the assistant message currently awaiting this approval, if still present.
  const chat = await getChat(chatId);
  if (!chat) return null;
  return chat.messages.find((m) => m.pendingApproval?.id === approvalId) ?? null;
}

export async function editUserMessage(
  chatId: string,
  messageId: string,
  content: string,
): Promise<ChatTranscript | null> {
  const chat = await getChat(chatId);
  if (!chat) return null;
  const idx = chat.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  const msg = chat.messages[idx]!;
  if (msg.role !== "user") return null;
  // Refuse while the reply to this message is still active in the queue.
  const nextAssistant = chat.messages[idx + 1];
  if (nextAssistant?.role === "assistant" && (nextAssistant.status === "streaming" || nextAssistant.status === "queued")) {
    throw new Error("That message is still being answered — stop it before editing.");
  }
  const trimmed = content.trim();
  const images = msg.images ?? [];
  if (!trimmed && images.length === 0) throw new Error("Message cannot be empty");
  const assistantId = newMessageId("a");
  const editedUser: ChatMessage = { ...msg, content: trimmed };
  const assistantMessage: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    status: "queued",
    steps: [],
    error: null,
  };
  // Editing truncates every message after it and re-runs from this point.
  const saved = await saveChat(chatId, {
    title: chat.title,
    messages: [...chat.messages.slice(0, idx), editedUser, assistantMessage],
  });
  broadcaster.emitEvent({ type: "chats" });
  const queue = getOrCreateQueue(chatId);
  queue.pending.push({ userMessage: editedUser, assistantId, contexts: editedUser.contexts ?? [] });
  void processChatQueue(chatId);
  return saved;
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
        return { ...m, status: "failed" as const, error: "Interrupted by server restart", pendingApproval: null };
      }
      if (m.pendingApproval) {
        changed = true;
        return { ...m, pendingApproval: null };
      }
      return m;
    });
    if (changed) await saveChat(chat.id, { title: chat.title, messages: nextMessages }).catch(() => {});
  }
}

export function getChatQueue(chatId: string): ChatQueueState | null {
  return queues.get(chatId) ?? null;
}
