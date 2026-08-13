import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { format } from "date-fns";
import { getWorkspace } from "./state.js";
import { getApiKey } from "./keychain.js";
import { isLocalEndpoint, resolveAiConfig, resolveContext, runAgenticLoop } from "./ai.js";
import { broadcaster } from "./watcher.js";
import type { AgentRun, ContextTarget } from "../shared/types.js";

function agentsDir(): string {
  const ws = getWorkspace();
  if (!ws) throw new Error("Workspace not configured");
  return join(ws, ".persona", "agents");
}

async function ensureAgentsDir(): Promise<string> {
  const dir = agentsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id) && !id.includes("..");
}

function fileFor(id: string): string {
  return join(agentsDir(), `${id}.json`);
}

function newId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function writeAgent(run: AgentRun): Promise<void> {
  await ensureAgentsDir();
  await writeFile(fileFor(run.id), JSON.stringify(run, null, 2), "utf8");
}

export async function listAgents(): Promise<AgentRun[]> {
  const dir = await ensureAgentsDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const runs: AgentRun[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as AgentRun;
      if (!parsed || !parsed.id || !Array.isArray(parsed.steps)) continue;
      runs.push(parsed);
    } catch {
      // skip corrupt files
    }
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getAgent(id: string): Promise<AgentRun | null> {
  if (!safeId(id)) return null;
  try {
    const raw = await readFile(fileFor(id), "utf8");
    const parsed = JSON.parse(raw) as AgentRun;
    if (!parsed || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteAgent(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  activeControllers.get(id)?.abort();
  const idx = queue.indexOf(id);
  if (idx !== -1) queue.splice(idx, 1);
  try {
    await rm(fileFor(id), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Mark any run left "running" by a previous process as failed. */
export async function reconcileInterruptedRuns(): Promise<void> {
  if (!getWorkspace()) return;
  const dir = await ensureAgentsDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const run = JSON.parse(raw) as AgentRun;
      if (run?.status === "running") {
        await writeAgent({
          ...run,
          status: "failed",
          error: "Interrupted by server restart",
          updatedAt: Date.now(),
        });
      }
    } catch {
      // skip corrupt files
    }
  }
}

const AGENT_SYSTEM = `You are Persona's autonomous agent. Complete the task the user gave you using the tools available. Work through it end-to-end in one pass without asking for clarification. When you are done, return a concise summary of what you did and any files you changed.`;

const activeControllers = new Map<string, AbortController>();
const queue: string[] = [];
let processing = false;

function emitAgents() {
  broadcaster.emitEvent({ type: "agents" });
}

function touch(run: AgentRun): AgentRun {
  return { ...run, updatedAt: Date.now() };
}

async function persistAndEmit(run: AgentRun): Promise<AgentRun> {
  await writeAgent(run);
  emitAgents();
  return run;
}

function availableKey(apiKey: string | null, local: boolean, baseUrl: string): string | null {
  if (apiKey) return apiKey;
  if (local || isLocalEndpoint(baseUrl)) return "ollama";
  return null;
}

async function runOne(id: string): Promise<void> {
  const run = await getAgent(id);
  if (!run) return;

  const controller = new AbortController();
  activeControllers.set(id, controller);

  let current = await persistAndEmit(touch({ ...run, status: "running", error: null }));
  let apiKey: string | null;
  try {
    apiKey = await getApiKey();
  } catch {
    apiKey = null;
  }

  const config = await resolveAiConfig();
  const local = config.local;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const key = availableKey(apiKey, local, baseUrl);

  if (!key) {
    await persistAndEmit(
      touch({ ...current, status: "failed", error: "No AI provider configured. Add an API key or start Ollama in Settings." }),
    );
    return;
  }
  if (local && !model) {
    await persistAndEmit(
      touch({ ...current, status: "failed", error: "Ollama is running but has no models installed. Pull one first." }),
    );
    return;
  }

  const client = new OpenAI({ apiKey: key, baseURL: baseUrl });
  const today = format(new Date(), "EEEE, yyyy-MM-dd");

  let contextBlock = "";
  try {
    if (run.contexts && run.contexts.length > 0) {
      contextBlock = await resolveContext(run.contexts);
    }
  } catch {
    contextBlock = "";
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        AGENT_SYSTEM +
        `\n\nToday's date is ${today}.` +
        (contextBlock ? `\n\nThe following context is attached to this task:\n${contextBlock}` : ""),
    },
    { role: "user", content: run.prompt },
  ];

  try {
    const { text } = await runAgenticLoop({
      client,
      model,
      baseUrl,
      usingLocal: local || isLocalEndpoint(baseUrl),
      messages,
      sources: new Map(),
      onDelta: undefined,
      onTool: async (name, status, detail) => {
        const latest = await getAgent(id);
        if (!latest) return;
        if (latest.status !== "running") return; // deleted/cancelled mid-run
        const step = { name, status, detail, at: Date.now() };
        // Replace a matching in-flight "start" with its "done", else append.
        let steps = latest.steps;
        if (status === "done") {
          const idx = [...steps].reverse().findIndex((s) => s.name === name && s.status === "start");
          if (idx !== -1) {
            const target = steps.length - 1 - idx;
            steps = steps.map((s, i) => (i === target ? step : s));
          } else {
            steps = [...steps, step];
          }
        } else {
          steps = [...steps, step];
        }
        await persistAndEmit(touch({ ...latest, steps }));
      },
      signal: controller.signal,
    });
    const finished = await getAgent(id);
    if (!finished) return;
    await persistAndEmit(touch({ ...finished, status: "done", result: text }));
  } catch (err) {
    const aborted = controller.signal.aborted;
    const latest = await getAgent(id);
    if (!latest) return;
    if (aborted) {
      await persistAndEmit(touch({ ...latest, status: "cancelled", error: null }));
    } else {
      await persistAndEmit(
        touch({ ...latest, status: "failed", error: err instanceof Error ? err.message : "Agent failed" }),
      );
    }
  } finally {
    activeControllers.delete(id);
  }
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      await runOne(id);
    }
  } finally {
    processing = false;
  }
}

export async function startAgent(
  prompt: string,
  contexts: ContextTarget[] = [],
): Promise<AgentRun> {
  const id = newId();
  const now = Date.now();
  const run: AgentRun = {
    id,
    prompt,
    status: "queued",
    result: "",
    error: null,
    steps: [],
    contexts,
    createdAt: now,
    updatedAt: now,
  };
  await persistAndEmit(run);
  queue.push(id);
  void processQueue();
  return run;
}

export async function cancelAgent(id: string): Promise<AgentRun | null> {
  const run = await getAgent(id);
  if (!run) return null;
  activeControllers.get(id)?.abort();
  if (run.status === "queued") {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    return persistAndEmit(touch({ ...run, status: "cancelled", error: null }));
  }
  return run;
}

export async function retryAgent(id: string): Promise<AgentRun | null> {
  const run = await getAgent(id);
  if (!run) return null;
  if (run.status === "running" || run.status === "queued") return run;
  const next = await persistAndEmit(
    touch({ ...run, status: "queued", error: null, result: "", steps: [] }),
  );
  queue.push(id);
  void processQueue();
  return next;
}
