import {
  createEntry,
  deleteEntry,
  entryExists,
  FsError,
  moveEntries,
  readFileContent,
  readTree,
  renameEntry,
  writeFileContent,
} from "./fs.js";
import { createTask, deleteTask, getTask, listTasks, parseTaskText, updateTask } from "./tasks.js";
import { fileKind } from "../shared/types.js";
import type { TaskPriority, TaskRecur, TaskStatus } from "../shared/types.js";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

const MAX_TOOL_CONTENT = 50_000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Write a file, creating it only when it genuinely does not exist. Any other
 * error (too large, escapes the workspace, …) propagates instead of silently
 * creating a near-duplicate via createEntry's name-deduping.
 */
async function writeNote(path: string, content: string) {
  try {
    await readFileContent(path);
    await writeFileContent(path, content);
  } catch (err) {
    if (err instanceof FsError && err.status === 404) {
      await createEntry(path, "file", content);
      return;
    }
    throw err;
  }
}

function isWorkspaceRoot(path: string): boolean {
  return path === "" || path === ".";
}

function isPersonaInternal(path: string): boolean {
  return path === ".persona" || path.startsWith(".persona/");
}

/** Non-text files are returned as a short notice instead of binary garbage. */
function binaryNotice(path: string, kind: string): string | null {
  if (kind === "pdf") return `"${path}" is a PDF — Persona can't read its text yet. You can open it in the Write view or paste a screenshot into the chat.`;
  if (kind === "image") return `"${path}" is an image — you can paste it into the chat for me to see, or open it in the Write view.`;
  return null;
}

/**
 * Accept an ISO date (YYYY-MM-DD) or natural language ("tomorrow",
 * "next week", "in 3 days", weekday names). Returns null when unparseable.
 */
function parseDue(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const parsed = parseTaskText(`task ${v}`);
  return parsed.due;
}

/** Parse a due value for create_task — throws on garbage so the model gets feedback. */
function dueOrThrow(value: string): string | null {
  if (!value.trim()) return null;
  const due = parseDue(value);
  if (!due) throw new Error(`could not parse due date "${value}" — use YYYY-MM-DD or natural language (e.g. tomorrow)`);
  return due;
}

function parseRecur(value: string): TaskRecur | null {
  const v = str(value).trim().toLowerCase();
  if (!v) return null;
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  const m = v.match(/^(\d+)(d|w|m)$/);
  if (m) return `${Math.min(Math.max(parseInt(m[1]!, 10), 1), 365)}${m[2]!}` as TaskRecur;
  return null;
}

function formatTask(t: { title: string; status: TaskStatus; due: string | null; priority: TaskPriority; project: string | null }): string {
  return (
    `[${t.status === "done" ? "x" : " "}] ${t.title}` +
    (t.due ? ` (due ${t.due})` : "") +
    (t.priority !== "medium" ? ` [${t.priority}]` : "") +
    (t.project ? ` #${t.project}` : "")
  );
}

const tools: ToolDef[] = [
  {
    name: "list_folder",
    description:
      "List the files and folders under a workspace folder. The result is the full tree of that folder — every subfolder and file it contains, with workspace-relative paths — so one call is enough to see everything. Use path \"\" for the whole workspace. After you find the file you need, read it with read_note.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path relative to the workspace root (use \"\" for the root)" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const path = str(args.path);
      const tree = await readTree(path || undefined);
      const lines = tree.map((n) => `${n.type === "folder" ? "dir" : "file"} ${n.path}`);
      return lines.join("\n") || "(empty)";
    },
  },
  {
    name: "read_note",
    description:
      "Read the contents of a note or text file at a workspace-relative path. Use this to inspect files (e.g. a PRD) before answering questions about them.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path, e.g. Projects/foo/PRD.md" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const path = str(args.path);
      if (!path) throw new Error("path is required");
      const kind = fileKind(path);
      const notice = binaryNotice(path, kind);
      if (notice) return notice;
      const content = await readFileContent(path);
      if (content.includes("\0")) {
        return `"${path}" is a binary file and can't be read as text.`;
      }
      if (content.length > MAX_TOOL_CONTENT) {
        return content.slice(0, MAX_TOOL_CONTENT) + "\n…(truncated)";
      }
      return content;
    },
  },
  {
    name: "create_note",
    description:
      "Create a new Markdown note at the given workspace-relative path. Fails if a file already exists at that path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "e.g. Notes/ideas.md" },
        content: { type: "string", description: "Full Markdown content of the note" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const path = str(args.path);
      const content = str(args.content);
      if (!path || !content) throw new Error("path and content are required");
      if (content.length > MAX_TOOL_CONTENT) throw new Error("content too large");
      try {
        await readFileContent(path);
        throw new Error(`a file already exists at ${path}; use write_note to overwrite it or append_note to add to it`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already exists")) throw err;
        if (!(err instanceof FsError && err.status === 404)) throw err;
      }
      await createEntry(path, "file", content);
      return `Created ${path}`;
    },
  },
  {
    name: "write_note",
    description: "Overwrite a note with new content, or create it if it does not exist yet. Content may be empty to clear a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path, e.g. Projects/foo/PRD.md" },
        content: { type: "string", description: "Full Markdown content (may be empty)" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const path = str(args.path);
      const content = str(args.content);
      if (!path) throw new Error("path is required");
      if (content.length > MAX_TOOL_CONTENT) throw new Error("content too large");
      await writeNote(path, content);
      return `Wrote ${path}`;
    },
  },
  {
    name: "append_note",
    description: "Append a section of Markdown to the end of an existing note (creates it if missing).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path, e.g. Notes/2026-08-11.md" },
        content: { type: "string", description: "Markdown to append" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const path = str(args.path);
      const content = str(args.content);
      if (!path || !content) throw new Error("path and content are required");
      if (content.length > MAX_TOOL_CONTENT) throw new Error("content too large");
      let current = "";
      try {
        current = await readFileContent(path);
      } catch (err) {
        if (!(err instanceof FsError && err.status === 404)) throw err;
      }
      const separator = !current ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      await writeNote(path, current + separator + content);
      return `Appended to ${path}`;
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder at the given workspace-relative path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "e.g. Projects/foo" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const path = str(args.path);
      if (!path) throw new Error("path is required");
      if (await entryExists(path)) {
        throw new Error(`a folder already exists at ${path}`);
      }
      await createEntry(path, "folder");
      return `Created folder ${path}`;
    },
  },
  {
    name: "list_tasks",
    description:
      "List every task in the task list with its id, status, priority, due date and project. Call this first to get a task's id before using update_task or delete_task.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const tasks = await listTasks();
      if (tasks.length === 0) return "(no tasks)";
      return tasks.map((t) => `${formatTask(t)} (id: ${t.id})`).join("\n");
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task. Due date may be an ISO date (YYYY-MM-DD) or natural language (\"tomorrow\", \"next week\", \"in 3 days\", weekday names). Priority is high, medium or low (default medium). Recur may be daily, weekly, monthly, or a number with d/w/m (e.g. 2w for every two weeks).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        due: { type: "string", description: "Due date: YYYY-MM-DD or natural language (optional)" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Optional, default medium" },
        project: { type: "string", description: "Optional project name" },
        recur: { type: "string", description: "Optional recurrence: daily, weekly, monthly, or N d/w/m" },
      },
      required: ["title"],
    },
    execute: async (args) => {
      const title = str(args.title).trim();
      if (!title) throw new Error("title is required");
      const priority = (args.priority === "high" || args.priority === "low" ? args.priority : "medium") as TaskPriority;
      const due = str(args.due) ? dueOrThrow(str(args.due)) : null;
      const project = str(args.project).trim() || null;
      const recur = parseRecur(str(args.recur));
      const task = await createTask({ title, priority, due, project, recur });
      return (
        `Created task "${task.title}"` +
        (task.due ? ` (due ${task.due})` : "") +
        (task.priority !== "medium" ? ` [${task.priority}]` : "") +
        (task.project ? ` #${task.project}` : "")
      );
    },
  },
  {
    name: "update_task",
    description:
      "Update an existing task. The id comes from list_tasks. Set status to \"done\" to complete it or \"todo\" to reopen it. Only the fields you provide are changed. Due date may be YYYY-MM-DD or natural language.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id from list_tasks" },
        title: { type: "string", description: "New title (optional)" },
        status: { type: "string", enum: ["todo", "done"], description: "todo or done (optional)" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Optional" },
        due: { type: "string", description: "Due date: YYYY-MM-DD or natural language (optional)" },
        project: { type: "string", description: "Project name (optional)" },
        recur: { type: "string", description: "Recurrence: daily, weekly, monthly, or N d/w/m (optional)" },
      },
      required: ["id"],
    },
    execute: async (args) => {
      const id = str(args.id).trim();
      if (!id) throw new Error("id is required");
      const existing = await getTask(id);
      if (!existing) throw new Error(`task ${id} not found — call list_tasks first to get the id`);
      const patch: Parameters<typeof updateTask>[1] = {};
      if (str(args.title).trim()) patch.title = str(args.title).trim();
      if (args.status === "todo" || args.status === "done") patch.status = args.status as TaskStatus;
      if (args.priority === "high" || args.priority === "low" || args.priority === "medium") {
        patch.priority = args.priority as TaskPriority;
      }
      if (args.due !== undefined) {
        const dueStr = str(args.due);
        patch.due = dueStr ? dueOrThrow(dueStr) : null;
      }
      if (args.project !== undefined) patch.project = str(args.project).trim() || null;
      const recur = parseRecur(str(args.recur));
      if (recur) patch.recur = recur;
      if (Object.keys(patch).length === 0) throw new Error("nothing to update — provide at least one field");
      const task = await updateTask(id, patch);
      if (!task) throw new Error(`task ${id} not found`);
      return `Updated task "${task.title}" to ${formatTask(task)}`;
    },
  },
  {
    name: "delete_task",
    description:
      "Delete a task. The id comes from list_tasks. Deleting is permanent — only use this when the user asked to delete or remove the task.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id from list_tasks" },
      },
      required: ["id"],
    },
    execute: async (args) => {
      const id = str(args.id).trim();
      if (!id) throw new Error("id is required");
      const existing = await getTask(id);
      if (!existing) throw new Error(`task ${id} not found — call list_tasks first to get the id`);
      await deleteTask(id);
      return `Deleted task "${existing.title}"`;
    },
  },
  {
    name: "move_file",
    description:
      "Move a file or folder to another folder in the workspace. Use target \"\" for the workspace root. Use rename_file to change a name.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the file or folder to move" },
        target: { type: "string", description: "Destination folder path relative to the workspace root (\"\" = root)" },
      },
      required: ["path", "target"],
    },
    execute: async (args) => {
      const path = str(args.path).trim();
      const target = str(args.target).trim();
      if (!path) throw new Error("path is required");
      if (isWorkspaceRoot(path) || isPersonaInternal(path)) throw new Error("cannot move the workspace root or .persona metadata");
      const moved = await moveEntries([path], target);
      return `Moved ${path} to ${moved[0] ?? target}`;
    },
  },
  {
    name: "rename_file",
    description: "Rename a file or folder. The new name must not contain slashes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the file or folder to rename" },
        name: { type: "string", description: "New name (no slashes)" },
      },
      required: ["path", "name"],
    },
    execute: async (args) => {
      const path = str(args.path).trim();
      const name = str(args.name).trim();
      if (!path) throw new Error("path is required");
      if (!name) throw new Error("name is required");
      if (isWorkspaceRoot(path) || isPersonaInternal(path)) throw new Error("cannot rename the workspace root or .persona metadata");
      const renamed = await renameEntry(path, name);
      return `Renamed ${path} to ${renamed}`;
    },
  },
  {
    name: "delete_file",
    description:
      "Permanently delete a file or folder (and everything inside it) from the workspace. Only use this when the user explicitly asked to delete the file or folder. Never delete the workspace root or .persona metadata.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the file or folder to delete" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const path = str(args.path).trim();
      if (!path) throw new Error("path is required");
      if (isWorkspaceRoot(path)) throw new Error("refusing to delete the workspace root");
      if (isPersonaInternal(path)) throw new Error("refusing to delete .persona metadata");
      if (!(await entryExists(path))) throw new Error(`nothing exists at ${path}`);
      await deleteEntry(path);
      return `Deleted ${path}`;
    },
  },
];

export const toolDefs = tools.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(args);
}
