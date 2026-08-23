import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
} from "../server/fs.js";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  parseTaskText,
  updateTask,
} from "../server/tasks.js";
import { search } from "../server/search.js";
import { getWorkspace, readConfig } from "../server/state.js";
import { fileKind } from "../shared/types.js";
import type { TaskPriority, TaskRecur, TaskStatus } from "../shared/types.js";

const MAX_TOOL_CONTENT = 50_000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

function binaryNotice(path: string, kind: string): string | null {
  if (kind === "pdf")
    return `"${path}" is a PDF — Persona can't read its text yet. You can open it in the Write view or paste a screenshot into the chat.`;
  if (kind === "image")
    return `"${path}" is an image — you can paste it into the chat for me to see, or open it in the Write view.`;
  return null;
}

function parseDue(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const parsed = parseTaskText(`task ${v}`);
  return parsed.due;
}

function dueOrThrow(value: string): string | null {
  if (!value.trim()) return null;
  const due = parseDue(value);
  if (!due)
    throw new Error(
      `could not parse due date "${value}" — use YYYY-MM-DD or natural language (e.g. tomorrow)`,
    );
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

function formatTask(t: {
  title: string;
  status: TaskStatus;
  due: string | null;
  priority: TaskPriority;
  project: string | null;
}): string {
  return (
    `[${t.status === "done" ? "x" : " "}] ${t.title}` +
    (t.due ? ` (due ${t.due})` : "") +
    (t.priority !== "medium" ? ` [${t.priority}]` : "") +
    (t.project ? ` #${t.project}` : "")
  );
}

function ensureWorkspace() {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "Workspace not configured. Run `persona` once and pick a workspace folder, or set ~/.persona/config.json workspace field.",
    );
  }
  return ws;
}

function toTextResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function toErrorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

export function createPersonaMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "persona",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    },
  );

  // Ensure keyword search index is ready (fire-and-forget, rebuilds on demand)
  try {
    void import("../server/search.js").then((m) => m.rebuildIndex());
  } catch {
    // ignore
  }

  // ------------------------------------------------------------------
  // workspace info
  // ------------------------------------------------------------------
  server.registerTool(
    "get_workspace_info",
    {
      title: "Get workspace info",
      description:
        "Get the current Persona workspace path and config. Use this first to confirm the workspace is configured.",
      inputSchema: {},
    },
    async () => {
      try {
        const ws = getWorkspace();
        const config = readConfig();
        if (!ws) {
          return toTextResult(
            "Workspace not configured. Run `persona` and pick a folder (default ~/Persona). Config lives at ~/.persona/config.json",
          );
        }
        const info = {
          workspace: ws,
          configured: Boolean(config.workspace),
          theme: config.theme ?? "system",
        };
        return toTextResult(JSON.stringify(info, null, 2));
      } catch (err) {
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ------------------------------------------------------------------
  // FS tools
  // ------------------------------------------------------------------
  server.registerTool(
    "list_folder",
    {
      title: "List folder",
      description:
        "List the files and folders under a workspace folder. The result is the full tree of that folder — every subfolder and file it contains, with workspace-relative paths — so one call is enough to see everything. Use path \"\" for the whole workspace. After you find the file you need, read it with read_note.",
      inputSchema: {
        path: z
          .string()
          .describe('Folder path relative to the workspace root (use "" for the root)')
          .default(""),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        const tree = await readTree(p || undefined);
        // Flatten the recursive tree so clients get the full listing in one call
        const flatten = (nodes: typeof tree, out: string[] = []): string[] => {
          for (const n of nodes) {
            out.push(`${n.type === "folder" ? "dir" : "file"} ${n.path}`);
            if (n.children) flatten(n.children, out);
          }
          return out;
        };
        const lines = flatten(tree);
        return toTextResult(lines.join("\n") || "(empty)");
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description:
        "Read the contents of a note or text file at a workspace-relative path. Use this to inspect files (e.g. a PRD) before answering questions about them.",
      inputSchema: {
        path: z.string().describe("Workspace-relative path, e.g. Projects/foo/PRD.md"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        if (!p) throw new Error("path is required");
        const kind = fileKind(p);
        const notice = binaryNotice(p, kind);
        if (notice) return toTextResult(notice);
        const content = await readFileContent(p);
        if (content.includes("\0")) {
          return toTextResult(`"${p}" is a binary file and can't be read as text.`);
        }
        if (content.length > MAX_TOOL_CONTENT) {
          return toTextResult(content.slice(0, MAX_TOOL_CONTENT) + "\n…(truncated)");
        }
        return toTextResult(content);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description:
        "Create a new Markdown note at the given workspace-relative path. Fails if a file already exists at that path.",
      inputSchema: {
        path: z.string().describe("e.g. Notes/ideas.md"),
        content: z.string().describe("Full Markdown content of the note"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, content }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        const c = str(content);
        if (!p || !c) throw new Error("path and content are required");
        if (c.length > MAX_TOOL_CONTENT) throw new Error("content too large");
        try {
          await readFileContent(p);
          throw new Error(
            `a file already exists at ${p}; use write_note to overwrite it or append_note to add to it`,
          );
        } catch (err) {
          if (err instanceof Error && err.message.includes("already exists")) throw err;
          if (!(err instanceof FsError && err.status === 404)) throw err;
        }
        await createEntry(p, "file", c);
        return toTextResult(`Created ${p}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "write_note",
    {
      title: "Write note",
      description:
        "Overwrite a note with new content, or create it if it does not exist yet. Content may be empty to clear a file.",
      inputSchema: {
        path: z.string().describe("Workspace-relative path, e.g. Projects/foo/PRD.md"),
        content: z.string().describe("Full Markdown content (may be empty)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, content }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        const c = str(content);
        if (!p) throw new Error("path is required");
        if (c.length > MAX_TOOL_CONTENT) throw new Error("content too large");
        await writeNote(p, c);
        return toTextResult(`Wrote ${p}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "append_note",
    {
      title: "Append note",
      description:
        "Append a section of Markdown to the end of an existing note (creates it if missing).",
      inputSchema: {
        path: z.string().describe("Workspace-relative path, e.g. Notes/2026-08-11.md"),
        content: z.string().describe("Markdown to append"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, content }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        const c = str(content);
        if (!p || !c) throw new Error("path and content are required");
        if (c.length > MAX_TOOL_CONTENT) throw new Error("content too large");
        let current = "";
        try {
          current = await readFileContent(p);
        } catch (err) {
          if (!(err instanceof FsError && err.status === 404)) throw err;
        }
        const separator = !current ? "" : current.endsWith("\n") ? "\n" : "\n\n";
        await writeNote(p, current + separator + c);
        return toTextResult(`Appended to ${p}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description: "Create a new folder at the given workspace-relative path.",
      inputSchema: {
        path: z.string().describe("e.g. Projects/foo"),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      try {
        ensureWorkspace();
        const p = str(path);
        if (!p) throw new Error("path is required");
        if (await entryExists(p)) {
          throw new Error(`a folder already exists at ${p}`);
        }
        await createEntry(p, "folder");
        return toTextResult(`Created folder ${p}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "move_file",
    {
      title: "Move file",
      description:
        "Move a file or folder to another folder in the workspace. Use target \"\" for the workspace root. Use rename_file to change a name.",
      inputSchema: {
        path: z.string().describe("Workspace-relative path of the file or folder to move"),
        target: z.string().describe('Destination folder path relative to the workspace root ("" = root)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, target }) => {
      try {
        ensureWorkspace();
        const p = str(path).trim();
        const t = str(target).trim();
        if (!p) throw new Error("path is required");
        if (isWorkspaceRoot(p) || isPersonaInternal(p))
          throw new Error("cannot move the workspace root or .persona metadata");
        const moved = await moveEntries([p], t);
        return toTextResult(`Moved ${p} to ${moved[0] ?? t}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "rename_file",
    {
      title: "Rename file",
      description: "Rename a file or folder. The new name must not contain slashes.",
      inputSchema: {
        path: z.string().describe("Workspace-relative path of the file or folder to rename"),
        name: z.string().describe("New name (no slashes)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, name }) => {
      try {
        ensureWorkspace();
        const p = str(path).trim();
        const n = str(name).trim();
        if (!p) throw new Error("path is required");
        if (!n) throw new Error("name is required");
        if (isWorkspaceRoot(p) || isPersonaInternal(p))
          throw new Error("cannot rename the workspace root or .persona metadata");
        const renamed = await renameEntry(p, n);
        return toTextResult(`Renamed ${p} to ${renamed}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete file",
      description:
        "Permanently delete a file or folder (and everything inside it) from the workspace. Only use this when the user explicitly asked to delete the file or folder. Never delete the workspace root or .persona metadata.",
      inputSchema: {
        path: z.string().describe("Workspace-relative path of the file or folder to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      try {
        ensureWorkspace();
        const p = str(path).trim();
        if (!p) throw new Error("path is required");
        if (isWorkspaceRoot(p)) throw new Error("refusing to delete the workspace root");
        if (isPersonaInternal(p)) throw new Error("refusing to delete .persona metadata");
        if (!(await entryExists(p))) throw new Error(`nothing exists at ${p}`);
        await deleteEntry(p);
        return toTextResult(`Deleted ${p}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ------------------------------------------------------------------
  // Tasks
  // ------------------------------------------------------------------
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List every task in the task list with its id, status, priority, due date and project. Call this first to get a task's id before using update_task or delete_task.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        ensureWorkspace();
        const tasks = await listTasks();
        if (tasks.length === 0) return toTextResult("(no tasks)");
        return toTextResult(tasks.map((t) => `${formatTask(t)} (id: ${t.id})`).join("\n"));
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a new task. Due date may be an ISO date (YYYY-MM-DD) or natural language (\"tomorrow\", \"next week\", \"in 3 days\", weekday names). Priority is high, medium or low (default medium). Recur may be daily, weekly, monthly, or a number with d/w/m (e.g. 2w for every two weeks).",
      inputSchema: {
        title: z.string().describe("Task title"),
        due: z
          .string()
          .optional()
          .describe("Due date: YYYY-MM-DD or natural language (optional)"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Optional, default medium"),
        project: z.string().optional().describe("Optional project name"),
        recur: z.string().optional().describe("Optional recurrence: daily, weekly, monthly, or N d/w/m"),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, due, priority, project, recur }) => {
      try {
        ensureWorkspace();
        const t = str(title).trim();
        if (!t) throw new Error("title is required");
        const prio = (priority === "high" || priority === "low" ? priority : "medium") as TaskPriority;
        const d = str(due) ? dueOrThrow(str(due)) : null;
        const proj = str(project).trim() || null;
        const r = parseRecur(str(recur));
        const task = await createTask({ title: t, priority: prio, due: d, project: proj, recur: r });
        return toTextResult(
          `Created task "${task.title}"` +
            (task.due ? ` (due ${task.due})` : "") +
            (task.priority !== "medium" ? ` [${task.priority}]` : "") +
            (task.project ? ` #${task.project}` : ""),
        );
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Update an existing task. The id comes from list_tasks. Set status to \"done\" to complete it or \"todo\" to reopen it. Only the fields you provide are changed. Due date may be YYYY-MM-DD or natural language.",
      inputSchema: {
        id: z.string().describe("Task id from list_tasks"),
        title: z.string().optional().describe("New title (optional)"),
        status: z.enum(["todo", "done"]).optional().describe("todo or done (optional)"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Optional"),
        due: z.string().optional().describe("Due date: YYYY-MM-DD or natural language (optional)"),
        project: z.string().optional().describe("Project name (optional)"),
        recur: z.string().optional().describe("Recurrence: daily, weekly, monthly, or N d/w/m (optional)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, title, status, priority, due, project, recur }) => {
      try {
        ensureWorkspace();
        const tid = str(id).trim();
        if (!tid) throw new Error("id is required");
        const existing = await getTask(tid);
        if (!existing) throw new Error(`task ${tid} not found — call list_tasks first to get the id`);
        const patch: Parameters<typeof import("../server/tasks.js").updateTask>[1] = {};
        if (str(title).trim()) patch.title = str(title).trim();
        if (status === "todo" || status === "done") patch.status = status as TaskStatus;
        if (priority === "high" || priority === "low" || priority === "medium") {
          patch.priority = priority as TaskPriority;
        }
        if (due !== undefined) {
          const dueStr = str(due);
          patch.due = dueStr ? dueOrThrow(dueStr) : null;
        }
        if (project !== undefined) patch.project = str(project).trim() || null;
        const r = parseRecur(str(recur));
        if (r) patch.recur = r;
        if (Object.keys(patch).length === 0)
          throw new Error("nothing to update — provide at least one field");
        const task = await updateTask(tid, patch);
        if (!task) throw new Error(`task ${tid} not found`);
        return toTextResult(`Updated task "${task.title}" to ${formatTask(task)}`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description:
        "Delete a task. The id comes from list_tasks. Deleting is permanent — only use this when the user asked to delete or remove the task.",
      inputSchema: {
        id: z.string().describe("Task id from list_tasks"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        ensureWorkspace();
        const tid = str(id).trim();
        if (!tid) throw new Error("id is required");
        const existing = await getTask(tid);
        if (!existing) throw new Error(`task ${tid} not found — call list_tasks first to get the id`);
        await deleteTask(tid);
        return toTextResult(`Deleted task "${existing.title}"`);
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  server.registerTool(
    "search",
    {
      title: "Search workspace",
      description:
        "Search files and tasks from the workspace (fuzzy + content + semantic). Returns matching files, tasks, and semantic hits with snippets.",
      inputSchema: {
        query: z.string().describe("Search query"),
        scope: z.string().optional().describe("Optional folder scope, e.g. Notes/ or Projects/foo"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, scope }) => {
      try {
        ensureWorkspace();
        const q = str(query).trim();
        if (!q) throw new Error("query is required");
        // Ensure keyword index is built — MCP doesn't auto-start the Hono watcher that does this.
        try {
          const { rebuildIndex } = await import("../server/search.js");
          await rebuildIndex();
        } catch {
          // ignore
        }
        const results = await search(q, scope ? str(scope) : undefined);
        const lines: string[] = [];
        for (const f of results.files) lines.push(`file  ${f.path}`);
        for (const t of results.tasks)
          lines.push(`task  ${t.title}${t.project ? ` #${t.project}` : ""}`);
        for (const h of results.semantic ?? []) {
          lines.push(`match ${h.path}`);
          lines.push(`      ${h.snippet}`);
        }
        if (lines.length === 0) return toTextResult("No matches.");
        return toTextResult(lines.join("\n"));
      } catch (err) {
        if (err instanceof FsError) return toErrorResult(err.message);
        return toErrorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ------------------------------------------------------------------
  // Resources — expose workspace as MCP resources for clients that prefer resources
  // ------------------------------------------------------------------
  server.registerResource(
    "workspace-files",
    "persona://workspace",
    {
      title: "Workspace files",
      description: "The Persona workspace file tree (MCP resource). Use tools like read_note for full content.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        ensureWorkspace();
        const tree = await readTree(undefined);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(tree, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  // Template resource for individual files: persona://file/{+path}
  // {+path} allows slashes so Notes/sub/file.md works (RFC6570 reserved expansion).
  server.registerResource(
    "workspace-file",
    new ResourceTemplate("persona://file/{+path}", {
      list: async () => {
        try {
          ensureWorkspace();
          const { walkFiles } = await import("../server/fs.js");
          const files = await walkFiles();
          return {
            resources: files.slice(0, 100).map((f) => ({
              name: f.name,
              uri: `persona://file/${f.path}`,
              mimeType: "text/markdown",
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      title: "Workspace file",
      description: "A single file from the Persona workspace. Path is workspace-relative, e.g. Notes/Welcome.md",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      try {
        ensureWorkspace();
        const rawPath = (variables as { path?: string }).path ?? "";
        // ResourceTemplate decodes URI components; persona://file/Notes/Welcome.md -> path=Notes/Welcome.md
        const p = decodeURIComponent(rawPath);
        if (!p) throw new Error("path is required");
        const kind = fileKind(p);
        const notice = binaryNotice(p, kind);
        if (notice) {
          return {
            contents: [{ uri: uri.href, mimeType: "text/plain", text: notice }],
          };
        }
        const content = await readFileContent(p);
        return {
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  // ------------------------------------------------------------------
  // Prompts — simple helpers for agents
  // ------------------------------------------------------------------
  server.registerPrompt(
    "triage-tasks",
    {
      title: "Triage tasks",
      description: "Review open tasks for wrong priorities, missing due dates, stale or duplicate tasks.",
    },
    async () => {
      try {
        ensureWorkspace();
        const tasks = await listTasks();
        if (tasks.length === 0) {
          return {
            messages: [{ role: "user" as const, content: { type: "text" as const, text: "No tasks to triage." } }],
          };
        }
        const lines = tasks.map((t) => `${formatTask(t)} (id: ${t.id})`).join("\n");
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Please triage these Persona tasks. Flag wrong priorities, missing due dates, untagged projects, stale tasks and duplicates. Suggest concrete changes.\n\n${lines}`,
              },
            },
          ],
        };
      } catch (err) {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Error loading tasks: ${err instanceof Error ? err.message : String(err)}`,
              },
            },
          ],
        };
      }
    },
  );

  return server;
}
