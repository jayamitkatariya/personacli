import OpenAI from "openai";
import { getApiKey } from "./keychain.js";
import { resolveAiConfig } from "./ai.js";
import type { Task, TriageKind, TriageSuggestion } from "../shared/types.js";

const MAX_TASKS = 60;
const MAX_TITLE_CHARS = 120;
const MAX_SUGGESTION_CHARS = 300;

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function daysBetween(fromIso: string): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

function toTriageInput(task: Task) {
  const dueIn =
    task.due && isValidDate(task.due)
      ? Math.ceil((new Date(`${task.due}T00:00:00`).getTime() - Date.now()) / 86_400_000)
      : null;
  return {
    id: task.id,
    title: task.title.slice(0, MAX_TITLE_CHARS),
    priority: task.priority,
    due: task.due,
    dueInDays: dueIn,
    project: task.project,
    recur: task.recur,
    created: task.created.slice(0, 10),
    updated: task.updated.slice(0, 10),
    daysSinceUpdate: daysBetween(task.updated),
  };
}

const TRIAGE_PROMPT = `You are Persona's task triage assistant. You are given a JSON array describing the user's open tasks.

Review the list and suggest improvements the user can apply with one click. Return ONLY a JSON array and nothing else. Do not change any task yourself.

Allowed kinds:
- "priority" — the task's priority looks wrong (e.g. an urgent, due-soon task is marked low, or a trivial task is marked high).
- "due" — an undated task needs a due date; suggest a specific future date.
- "project" — an untagged task fits an existing project in the list; use its exact name.
- "stale" — the task is clearly outdated or likely done (e.g. untouched for weeks); suggest completing it.
- "duplicate" — two tasks are essentially the same; mention both titles in "suggestion". No "apply" field.

Rules:
- Be conservative: only suggest when reasonably confident.
- At most one suggestion per task.
- "apply" only contains fields that change: {"priority": "high"|"medium"|"low"}, {"due": "YYYY-MM-DD"}, {"project": "name"}, or {"status": "done"}.
- "due" dates must be valid YYYY-MM-DD dates. Prefer a date within the next two weeks unless the task clearly needs longer.
- For "project", prefer an existing project name from the list; otherwise use one short word.
- "suggestion" is one short, concrete sentence with a reason.
- No comments, no markdown, no keys besides taskId, kind, suggestion, apply.

Example:
[{"taskId": "buy-domain-abc1", "kind": "due", "suggestion": "The domain offer expires Friday — set a due date so it isn't forgotten.", "apply": {"due": "2026-08-14"}}]`;

interface RawApply {
  priority?: unknown;
  due?: unknown;
  project?: unknown;
  status?: unknown;
}

/**
 * Parse the model's reply into validated suggestions. Anything malformed or
 * referencing unknown/completed tasks is dropped — this is the safety gate:
 * `apply` patches only ever contain one of the whitelisted fields.
 */
export function extractSuggestions(text: string, tasks: Task[]): TriageSuggestion[] {
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
        return [];
      }
    }
  }
  if (!Array.isArray(arr)) return [];

  const byId = new Map(tasks.filter((t) => t.status === "todo").map((t) => [t.id, t]));
  const out: TriageSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const taskId = typeof r.taskId === "string" ? r.taskId : "";
    const task = byId.get(taskId);
    if (!task) continue;
    const kind = r.kind;
    if (kind !== "priority" && kind !== "due" && kind !== "project" && kind !== "stale" && kind !== "duplicate") continue;
    const suggestion = typeof r.suggestion === "string" ? r.suggestion.trim().slice(0, MAX_SUGGESTION_CHARS) : "";
    if (!suggestion) continue;

    const item: TriageSuggestion = { taskId, kind: kind as TriageKind, suggestion };
    const apply = (typeof r.apply === "object" && r.apply !== null ? r.apply : {}) as RawApply;
    if (kind === "priority" && (apply.priority === "high" || apply.priority === "medium" || apply.priority === "low")) {
      item.apply = { priority: apply.priority };
    } else if (kind === "due" && typeof apply.due === "string" && isValidDate(apply.due)) {
      item.apply = { due: apply.due };
    } else if (kind === "project" && typeof apply.project === "string") {
      const project = apply.project.trim().replace(/^#/, "").slice(0, 32);
      if (/^[\w-]+$/.test(project)) item.apply = { project };
    } else if (kind === "stale" && apply.status === "done") {
      item.apply = { status: "done" };
    }
    out.push(item);
  }
  return out;
}

/**
 * Ask the configured AI to review the user's open tasks. Returns [] when the
 * model is reached but has nothing to say; throws a descriptive error when no
 * AI is available, so the caller can tell the user why triage can't run.
 */
export async function triageTasks(tasks: Task[]): Promise<TriageSuggestion[]> {
  const open = tasks.filter((t) => t.status === "todo").slice(0, MAX_TASKS);
  if (open.length === 0) return [];

  let apiKey = await getApiKey();
  const { baseUrl, model, local } = await resolveAiConfig();
  if (!apiKey) {
    if (local || isLocalEndpoint(baseUrl)) {
      apiKey = "ollama";
    } else {
      throw new Error("No AI provider available for task triage — add an API key in Settings → AI.");
    }
  }
  if (local && !model) {
    throw new Error('No chat model available in Ollama for task triage — install one with `ollama pull llama3.2`.');
  }

  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  // Stream the response — some providers return empty content on non-streaming
  // requests. Avoid max_tokens: it is ignored or breaks output on several
  // OpenAI-compatible providers.
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: TRIAGE_PROMPT },
      { role: "user", content: JSON.stringify(open.map(toTriageInput)) },
    ],
    temperature: 0.2,
  });
  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content ?? "";
  }
  return extractSuggestions(text, open);
}
