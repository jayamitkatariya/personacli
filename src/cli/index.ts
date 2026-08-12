#!/usr/bin/env node
import { cac } from "cac";
import { spawn } from "node:child_process";
import { existsSync, appendFileSync, openSync, createWriteStream } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import {
  getWorkspace,
  readState,
  writeState,
  readConfig,
  serverLogPath,
  ensureConfigDir,
} from "../server/state.js";
import { findFreePort, isPersonaServer } from "../server/port.js";
import { detectOllama } from "../server/ollama.js";
import type { ContextTarget, TriageSuggestion } from "../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function appendLog(file: string, line: string) {
  try {
    appendFileSync(file, line);
  } catch {
    // ignore
  }
}

function banner() {
  console.log("");
  console.log("  ✦ Persona — local-first personal workspace");
  console.log("");
}

function resolveServerScript(): { script: string; viaTsx: boolean } {
  const prod = join(__dirname, "..", "server", "index.js");
  if (existsSync(prod)) return { script: prod, viaTsx: false };
  const src = join(__dirname, "..", "..", "src", "server", "index.ts");
  const tsx = join(__dirname, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(src) && existsSync(tsx)) return { script: src, viaTsx: true };
  throw new Error("Persona server build not found. Run `npm run build` first.");
}

async function isRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(700),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === "persona";
  } catch {
    return false;
  }
}

async function startServer(headless = false): Promise<number> {
  if (!headless) banner();
  const firstRun = !getWorkspace();
  const workspace = firstRun ? "~/Persona (first run)" : getWorkspace();
  console.log("Starting Persona...");
  console.log(`Workspace: ${workspace}`);
  console.log("");

  const port = await findFreePort();
  const { script, viaTsx } = resolveServerScript();
  ensureConfigDir();

  const logFile = serverLogPath();
  appendLog(logFile, `\n[${new Date().toISOString()}] starting on port ${port}\n`);
  const logFd = openSync(logFile, "a");
  const logStream = createWriteStream(null as unknown as string, { fd: logFd, autoClose: false });

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, PORT: String(port) },
  });
  child.on("error", (err) => {
    console.error("Failed to start server:", err.message);
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await isRunning(port)) {
      console.log(`Server: http://localhost:${port}`);
      if (!headless) console.log("Opening browser...");
      if (firstRun && !headless) {
        console.log("");
        console.log("  First run? The browser will guide you: pick a workspace,");
        console.log("  connect an AI model, and get a Welcome note. You can also:");
        console.log('    persona task "Buy domain tomorrow #personal !!"');
        console.log('    persona note "hello from the terminal"');
        console.log("    persona today");
        console.log("    persona doctor");
        console.log("");
      }
      writeState({ port, pid: child.pid ?? process.pid, startedAt: Date.now() });
      return port;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error("Server did not start. Check the log:");
  console.error(`  ${logFile}`);
  process.exit(1);
}

async function ensureServer(headless = false): Promise<number> {
  const state = readState();
  if (state && (await isRunning(state.port))) return state.port;
  return startServer(headless);
}

async function openPersona(port?: number): Promise<number> {
  if (port === undefined || !(await isRunning(port))) {
    port = await startServer();
  } else {
    banner();
    console.log("Opening Persona...");
  }
  await open(`http://localhost:${port}`);
  return port;
}

async function apiJson<T>(port: number, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
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

const jsonInit = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const cli = cac("persona");

cli.command("", "Open the Persona workspace").action(() => openPersona());

cli.command("open", "Open Persona in your browser").action(() => openPersona());

cli.command("note <text...>", "Append a line to today's journal note")
  .action(async (text: string[]) => {
    const line = (Array.isArray(text) ? text : [text]).join(" ");
    if (!line.trim()) {
      console.error('Usage: persona note "your text"');
      process.exit(1);
    }
    const port = await ensureServer(true);
    try {
      const { path } = await apiJson<{ path: string }>(port, "/api/capture", jsonInit({ text: line }));
      console.log(`Saved to ${path}`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

cli.command("task <text...>", "Create a task (natural language)")
  .action(async (text: string[]) => {
    const line = (Array.isArray(text) ? text : [text]).join(" ");
    if (!line.trim()) {
      console.error('Usage: persona task "Buy domain tomorrow #personal !!"');
      process.exit(1);
    }
    const port = await ensureServer(true);
    try {
      const task = await apiJson<{ id: string; title: string; due: string | null; project: string | null; priority: string }>(
        port,
        "/api/tasks",
        jsonInit({ text: line }),
      );
      console.log(
        `Created: ${task.title}` +
          (task.due ? ` (due ${task.due})` : "") +
          (task.project ? ` #${task.project}` : "") +
          (task.priority !== "medium" ? ` [${task.priority}]` : ""),
      );
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

cli.command("today", "Create or open today's journal note")
  .option("--open", "Also open the workspace in your browser")
  .action(async (options: { open?: boolean }) => {
    const port = await ensureServer(!options.open);
    try {
      const { path } = await apiJson<{ path: string }>(port, "/api/capture", jsonInit({ text: "" }));
      console.log(`Today's note: ${path}`);
      if (options.open) await open(`http://localhost:${port}`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

cli.command("triage", "Ask the AI to review your tasks (suggestions only)")
  .action(async () => {
    const port = await ensureServer(true);
    try {
      const { suggestions } = await apiJson<{ suggestions: TriageSuggestion[] }>(port, "/api/tasks/triage", {
        method: "POST",
      });
      if (suggestions.length === 0) {
        console.log("Task triage: no suggestions — you're all caught up.");
        return;
      }
      console.log(`Task triage: ${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} for your open tasks`);
      console.log("");
      for (const s of suggestions) {
        const kind = s.kind.padEnd(10);
        console.log(`  [${kind}] ${s.suggestion}`);
      }
      console.log("");
      console.log("Nothing was changed. Apply them one-click in the Tasks view (Triage button).");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

cli.command("search <query...>", "Search files and tasks").action(async (query: string[]) => {
    const q = (Array.isArray(query) ? query : [query]).join(" ");
    if (!q.trim()) {
      console.error("Usage: persona search <query>");
      process.exit(1);
    }
    const port = await ensureServer(true);
    try {
      const results = await apiJson<{
        files: { path: string }[];
        tasks: { title: string; project: string | null }[];
        semantic: { path: string; snippet: string }[];
      }>(port, `/api/fs/search?q=${encodeURIComponent(q)}`);
      for (const f of results.files) console.log(`file  ${f.path}`);
      for (const t of results.tasks) console.log(`task  ${t.title}${t.project ? ` #${t.project}` : ""}`);
      for (const h of results.semantic ?? []) {
        console.log(`match ${h.path}`);
        console.log(`      ${h.snippet}`);
      }
      if (results.files.length === 0 && results.tasks.length === 0 && (results.semantic ?? []).length === 0) {
        console.log("No matches.");
      }
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

interface FlatNode {
  path: string;
  name: string;
  type: "file" | "folder";
  children?: FlatNode[];
}

function flattenTree(nodes: FlatNode[], out: FlatNode[] = []): FlatNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flattenTree(n.children, out);
  }
  return out;
}

async function resolveMentions(
  text: string,
  port: number,
): Promise<{ text: string; contexts: ContextTarget[]; warnings: string[] }> {
  const contexts: ContextTarget[] = [];
  const warnings: string[] = [];
  let tree: FlatNode[] = [];
  try {
    tree = await apiJson<FlatNode[]>(port, "/api/fs/tree");
  } catch {
    return { text, contexts, warnings };
  }
  const all = flattenTree(tree).filter((n) => n.path !== ".persona");
  const cleaned = text.replace(/@([\w./-]+)/g, (full, mention) => {
    if (mention === "tasks") {
      contexts.push({ type: "tasks", path: "" });
      return "";
    }
    const q = mention.toLowerCase();
    const hits = all.filter(
      (n) =>
        n.path === mention ||
        n.path.endsWith(`/${mention}`) ||
        n.name.toLowerCase().includes(q),
    );
    if (hits.length === 0) {
      warnings.push(`No file or folder found for @${mention} — leaving it in the question.`);
      return full;
    }
    const hit = hits[0] as FlatNode;
    contexts.push({ type: hit.type === "folder" ? "folder" : "file", path: hit.path });
    return "";
  });
  return { text: cleaned.trim(), contexts, warnings };
}

cli.command("ask <...text>", "Ask the AI from the terminal (supports @file, @folder, @tasks)")
  .action(async (text: string[]) => {
    const question = (Array.isArray(text) ? text : [text]).join(" ").trim();
    if (!question) {
      console.error('Usage: persona ask "what is left on the PRD?"');
      process.exit(1);
    }
    const port = await ensureServer(true);
    const { text: cleaned, contexts, warnings } = await resolveMentions(question, port);
    for (const w of warnings) console.error(`! ${w}`);
    for (const c of contexts) {
      console.error(`· attached ${c.type === "tasks" ? "@tasks" : `@${c.path}`}`);
    }
    if (!cleaned) {
      console.error("Nothing to ask (the question was only mentions).");
      process.exit(1);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: cleaned }],
          contexts,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok || !res.body) {
        console.error(`Chat request failed (${res.status})`);
        process.exit(1);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawAnswer = false;
      let failed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let ev: { type: string; content?: string; name?: string; status?: string; message?: string };
            try {
              ev = JSON.parse(line.slice(5).trim()) as typeof ev;
            } catch {
              continue;
            }
            if (ev.type === "delta" && ev.content) {
              process.stdout.write(ev.content);
              sawAnswer = true;
            } else if (ev.type === "tool") {
              console.error(`[tool] ${ev.name} ${ev.status === "start" ? "started" : "done"}`);
            } else if (ev.type === "error" && ev.message) {
              console.error(`\nError: ${ev.message}`);
              failed = true;
            }
          }
        }
      }
      process.stdout.write(sawAnswer ? "\n" : "");
      if (failed) process.exit(1);
      if (!sawAnswer) console.error("No response received.");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  });

cli.command("path", "Print the current workspace path").action(() => {
  const ws = getWorkspace();
  console.log(ws ? resolve(ws) : "Workspace not configured yet.");
});

cli
  .command("doctor", "Check that Persona is healthy")
  .action(async () => {
    console.log("Persona doctor");
    console.log("─────────────");
    console.log(`Node: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    const state = readState();
    const ws = getWorkspace();
    console.log(`Workspace: ${ws ?? "not configured"}`);
    const up = state ? await isRunning(state.port) : false;
    console.log(`Server: ${up ? `running on :${state?.port}` : "not running"}`);
    const config = readConfig();
    console.log(
      `AI: ${config.ai?.model ?? "default model"} @ ${config.ai?.baseUrl ?? "https://api.openai.com/v1"}`,
    );
    const local = await detectOllama();
    if (local && !local.model) {
      console.log(`Local LLM: ${local.name} detected at ${local.baseUrl} — no models installed (run \`ollama pull llama3.2\`)`);
    } else if (local) {
      console.log(
        `Local LLM: ${local.name} detected at ${local.baseUrl} (${local.model}) — will be used automatically`,
      );
    } else {
      console.log("Local LLM: no Ollama detected — an API key is required for chat");
    }
    console.log("─────────────");
    console.log("All good." + (up ? "" : " Run `persona` to start."));
  });

cli.help();
cli.version("0.1.0");

if (process.argv.length <= 2) {
  openPersona();
} else {
  cli.parse();
}
