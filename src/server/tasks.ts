import { readdir, readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { format, parse, isValid, addDays, addWeeks, addMonths } from "date-fns";
import { workspaceRoot } from "./fs.js";
import type { ParsedTask, Task, TaskPriority, TaskRecur, TaskStatus } from "../shared/types.js";

export function tasksDir(): string {
  return join(workspaceRoot(), ".persona", "tasks");
}

export async function ensureTasksDir() {
  await mkdir(tasksDir(), { recursive: true });
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface Frontmatter {
  type?: string;
  status?: string;
  priority?: string;
  due?: string;
  project?: string;
  recur?: string;
  completed_count?: string;
  created?: string;
  updated?: string;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { meta: {}, body: content };
  const meta: Frontmatter = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) (meta as Record<string, string>)[key] = value;
  }
  return { meta, body: (match[2] ?? "").trim() };
}

function serializeFrontmatter(meta: Frontmatter, body: string): string {
  const lines = ["---", `type: ${meta.type ?? "task"}`];
  if (meta.status) lines.push(`status: ${meta.status}`);
  if (meta.priority) lines.push(`priority: ${meta.priority}`);
  if (meta.due) lines.push(`due: ${meta.due}`);
  if (meta.project) lines.push(`project: ${meta.project}`);
  if (meta.recur) lines.push(`recur: ${meta.recur}`);
  if (meta.completed_count) lines.push(`completed_count: ${meta.completed_count}`);
  if (meta.created) lines.push(`created: ${meta.created}`);
  if (meta.updated) lines.push(`updated: ${meta.updated}`);
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

function parseRecur(value: string | undefined): TaskRecur | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  const m = v.match(/^(\d+)([dwm])$/);
  if (m) return `${Math.min(Math.max(parseInt(m[1]!, 10), 1), 365)}${m[2]!}` as TaskRecur;
  return null;
}

/** Advance a due date by the recurrence interval. */
function nextDue(recur: TaskRecur, from: Date): string {
  const m = recur.match(/^(\d+)([dwm])$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (m[2] === "d") return format(addDays(from, n), "yyyy-MM-dd");
    if (m[2] === "w") return format(addDays(from, n * 7), "yyyy-MM-dd");
    return format(addMonths(from, n), "yyyy-MM-dd");
  }
  if (recur === "weekly") return format(addWeeks(from, 1), "yyyy-MM-dd");
  if (recur === "monthly") return format(addMonths(from, 1), "yyyy-MM-dd");
  return format(addDays(from, 1), "yyyy-MM-dd");
}

export async function listTasks(): Promise<Task[]> {
  await ensureTasksDir();
  const dir = tasksDir();
  const entries = await readdir(dir);
  const tasks: Task[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const full = join(dir, entry);
    try {
      const content = await readFile(full, "utf8");
      const { meta, body } = parseFrontmatter(content);
      const s = await stat(full);
      tasks.push({
        id: entry.replace(/\.md$/, ""),
        title: body || "(untitled)",
        status: (meta.status === "done" ? "done" : "todo") as TaskStatus,
        priority: (meta.priority === "high" || meta.priority === "low" ? meta.priority : "medium") as TaskPriority,
        due: meta.due && /^\d{4}-\d{2}-\d{2}$/.test(meta.due) ? meta.due : null,
        project: meta.project || null,
        recur: parseRecur(meta.recur),
        created: meta.created ?? new Date(s.birthtimeMs || Date.now()).toISOString(),
        updated: meta.updated ?? new Date(s.mtimeMs).toISOString(),
        path: relative(workspaceRoot(), full).split(sep).join("/"),
      });
    } catch {
      // skip unreadable files
    }
  }
  tasks.sort((a, b) => (a.created < b.created ? -1 : 1));
  return tasks;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Parse "Buy domain tomorrow #personal !!" into title/priority/due/project. */
export function parseTaskText(text: string): ParsedTask {
  let rest = text.trim();
  let project: string | null = null;

  const projectMatch = rest.match(/(^|\s)#([\w-]+)/);
  if (projectMatch) {
    project = projectMatch[2] ?? null;
    rest = rest.replace(projectMatch[0], " ").trim();
  }

  let recur: TaskRecur | null = null;
  const recurMatch = rest.match(
    /\b(every \d+ (?:day|week|month)s?|every day|daily|every week|weekly|every month|monthly)\b/i,
  );
  if (recurMatch) {
    const raw = recurMatch[0]!.toLowerCase();
    if (raw === "daily" || raw === "every day") recur = "daily";
    else if (raw === "weekly" || raw === "every week") recur = "weekly";
    else if (raw === "monthly" || raw === "every month") recur = "monthly";
    else {
      const m = raw.match(/every (\d+) (day|week|month)s?/);
      if (m) recur = `${Math.min(Math.max(parseInt(m[1]!, 10), 1), 365)}${m[2]!.slice(0, 1)}` as TaskRecur;
    }
    rest = rest.replace(recurMatch[0], " ").trim();
  }

  let priority: TaskPriority = "medium";
  const prioMatch = rest.match(/!+$/);
  if (prioMatch) {
    const bangCount = (prioMatch[0] ?? "").length;
    priority = bangCount >= 2 ? "high" : "low";
    rest = rest.replace(/!+$/, "").trim();
  }

  let due: string | null = null;
  const today = new Date();

  const iso = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    const parsed = parse(iso[1]!, "yyyy-MM-dd", today);
    if (isValid(parsed)) due = iso[1]!;
    rest = rest.replace(iso[0], " ").trim();
  }

  const rel = rest.match(/\b(in \d+ days?|tomorrow|today|next week|(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
  if (rel) {
    const raw = rel[0]!.toLowerCase();
    let target: Date | null = null;
    if (raw === "tomorrow") target = addDays(today, 1);
    else if (raw === "today") target = today;
    else if (raw === "next week") target = addWeeks(today, 1);
    else if (raw.startsWith("in ")) {
      const n = parseInt(raw.match(/\d+/)?.[0] ?? "1", 10);
      target = addDays(today, Math.min(Math.max(n, 1), 365));
    } else {
      const day = WEEKDAYS[raw] ?? WEEKDAYS[raw.replace(/day$/, "")];
      if (day !== undefined) {
        let d = addDays(today, (day - today.getDay() + 7) % 7);
        if (d.getDay() === today.getDay() && format(d, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")) {
          d = addDays(d, 7);
        }
        if (d.getTime() <= today.getTime()) d = addDays(d, 7);
        target = d;
      }
    }
    if (target && isValid(target)) due = format(target, "yyyy-MM-dd");
    rest = rest.replace(rel[0], " ").trim();
  }

  return {
    title: rest || "(untitled)",
    priority,
    due,
    project,
    recur,
  };
}

const BULLET_RE = /^\s*(?:[-*•▪◦‣·]|\d+[.)]|\([a-zA-Z\d]\)|>|#)\s+/;

/**
 * Split a free-form paragraph into individual task items.
 * - Newlines are always treated as separators.
 * - List markers (-, *, •, 1., (a), >, #) are stripped.
 * - A single un-bulleted line is split on commas/semicolons so
 *   "call mom, buy milk; email sarah" becomes three tasks.
 */
export function splitTaskText(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter((line) => line.length > 0);
  if (lines.length === 1 && !BULLET_RE.test(text)) {
    const parts = (lines[0] ?? "")
      .split(/[,;]\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1) return parts;
  }
  return lines;
}

/**
 * Parse and create every task described in a free-form paragraph.
 * Items with no explicit due date are scheduled for today, so the
 * paragraph reads as "what I want to do today".
 */
export async function createTasksBulk(text: string): Promise<Task[]> {
  const created: Task[] = [];
  const today = format(new Date(), "yyyy-MM-dd");
  for (const item of splitTaskText(text)) {
    const parsed = parseTaskText(item);
    const task = await createTask({
      ...parsed,
      due: parsed.due ?? today,
    });
    created.push(task);
  }
  return created;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "task"
  );
}

export async function createTask(parsed: ParsedTask): Promise<Task> {
  await ensureTasksDir();
  const now = new Date();
  const id = `${slugify(parsed.title)}-${Math.random().toString(36).slice(2, 6)}`;
  const path = join(tasksDir(), `${id}.md`);
  const body = serializeFrontmatter(
    {
      type: "task",
      status: "todo",
      priority: parsed.priority,
      due: parsed.due ?? undefined,
      project: parsed.project ?? undefined,
      recur: parsed.recur ?? undefined,
      created: now.toISOString(),
      updated: now.toISOString(),
    },
    parsed.title,
  );
  await writeFile(path, body, "utf8");
  return {
    id,
    title: parsed.title,
    status: "todo",
    priority: parsed.priority,
    due: parsed.due,
    project: parsed.project,
    recur: parsed.recur,
    created: now.toISOString(),
    updated: now.toISOString(),
    path: relative(workspaceRoot(), path).split(sep).join("/"),
  };
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "status" | "priority" | "due" | "project" | "recur">>,
): Promise<Task | null> {
  const full = resolve(tasksDir(), `${id}.md`);
  const content = await readFile(full, "utf8").catch(() => null);
  if (content === null) return null;
  const { meta, body } = parseFrontmatter(content);
  const next: Frontmatter = {
    ...meta,
    status: patch.status ?? (meta.status as TaskStatus) ?? "todo",
    priority: patch.priority ?? (meta.priority as TaskPriority) ?? "medium",
    due: patch.due !== undefined ? patch.due ?? undefined : meta.due,
    project: patch.project !== undefined ? patch.project ?? undefined : meta.project,
    recur: patch.recur !== undefined ? patch.recur ?? undefined : meta.recur,
    updated: new Date().toISOString(),
  };

  // Recurring task completed → reopen as the next occurrence
  if (patch.status === "done" && next.recur && meta.status !== "done") {
    const base =
      meta.due && /^\d{4}-\d{2}-\d{2}$/.test(meta.due)
        ? parse(meta.due, "yyyy-MM-dd", new Date())
        : new Date();
    next.status = "todo";
    next.due = nextDue(next.recur as TaskRecur, isValid(base) ? base : new Date());
    next.completed_count = String((parseInt(meta.completed_count ?? "0", 10) || 0) + 1);
  }

  const nextBody = patch.title ?? body;
  await writeFile(full, serializeFrontmatter(next, nextBody), "utf8");
  return {
    id,
    title: nextBody,
    status: (next.status === "done" ? "done" : "todo") as TaskStatus,
    priority: (next.priority === "high" || next.priority === "low" ? next.priority : "medium") as TaskPriority,
    due: next.due && /^\d{4}-\d{2}-\d{2}$/.test(next.due) ? next.due : null,
    project: next.project || null,
    recur: parseRecur(next.recur),
    created: next.created ?? new Date().toISOString(),
    updated: next.updated ?? new Date().toISOString(),
    path: relative(workspaceRoot(), full).split(sep).join("/"),
  };
}

/** Find a single task by id, or null when it does not exist. */
export async function getTask(id: string): Promise<Task | null> {
  const full = resolve(tasksDir(), `${id}.md`);
  const content = await readFile(full, "utf8").catch(() => null);
  if (content === null) return null;
  const { meta, body } = parseFrontmatter(content);
  const s = await stat(full).catch(() => null);
  return {
    id,
    title: body || "(untitled)",
    status: (meta.status === "done" ? "done" : "todo") as TaskStatus,
    priority: (meta.priority === "high" || meta.priority === "low" ? meta.priority : "medium") as TaskPriority,
    due: meta.due && /^\d{4}-\d{2}-\d{2}$/.test(meta.due) ? meta.due : null,
    project: meta.project || null,
    recur: parseRecur(meta.recur),
    created: meta.created ?? (s ? new Date(s.birthtimeMs || Date.now()).toISOString() : new Date().toISOString()),
    updated: meta.updated ?? (s ? new Date(s.mtimeMs).toISOString() : new Date().toISOString()),
    path: relative(workspaceRoot(), full).split(sep).join("/"),
  };
}

export async function deleteTask(id: string) {
  await unlink(resolve(tasksDir(), `${id}.md`)).catch(() => {});
}
