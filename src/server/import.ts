import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { copyFile, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createEntry, resolveSafe } from "./fs.js";
import { broadcaster } from "./watcher.js";
import type { ImportPreview, ImportResult, ImportSource } from "../shared/types.js";

const execFileP = promisify(execFile);

interface ConvertedNote {
  relPath: string;
  content: string;
}

interface Attachment {
  from: string;
  to: string;
}

interface Importer {
  accept: (relPath: string, isDir: boolean) => boolean;
  convert: (absPath: string, relPath: string) => Promise<ConvertedNote[] | null>;
  collectAttachments?: (absPath: string, relPath: string) => Promise<Attachment[]>;
}

function normalizeRel(relPath: string, source: ImportSource): string {
  let p = relPath.split(sep).join("/").replace(/^\/+/, "");
  const unsafe = /[<>:"|?*\u0000-\u001f]/g;
  p = p.replace(unsafe, "-");
  const ext = extname(p).toLowerCase();
  if (source !== "notion" && source !== "roam") {
    if (ext !== ".md" && ext !== ".markdown" && ext !== ".txt") {
      p = p.replace(/\.[^.]+$/, "") + ".md";
    } else if (ext !== ".md") {
      p = p.slice(0, -ext.length) + ".md";
    }
  }
  return p;
}

async function walkAll(root: string): Promise<{ abs: string; rel: string; isDir: boolean }[]> {
  const out: { abs: string; rel: string; isDir: boolean }[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs);
      const isDir = e.isDirectory();
      out.push({ abs, rel, isDir });
      if (isDir) await walk(abs);
    }
  }
  await walk(root);
  return out;
}

function wikiLinkToMarkdown(text: string): string {
  return text
    .replace(/!\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, target: string, alias: string) => {
      const clean = target.trim();
      const label = alias.trim() || clean;
      return `![${label}](./${clean})`;
    })
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, target: string, alias: string) => {
      const clean = target.trim();
      const label = alias.trim() || clean;
      return `[${label}](${clean}.md)`;
    });
}

function stripObsidianFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return content;
  const fm = (match[1] ?? "")
    .split("\n")
    .filter((line) => {
      const key = line.split(":")[0]?.trim();
      return key !== "aliases" && key !== "cssclasses";
    })
    .join("\n");
  return fm.trim() ? `---\n${fm}\n---\n${match[2] ?? ""}` : match[2] ?? "";
}

function bearHeaderToFrontmatter(content: string): string {
  const lines = content.split("\n");
  const tags: string[] = [];
  const titleLine = lines.findIndex((l) => /^(#|Title:)\s+/i.test(l));
  if (titleLine !== -1) lines.splice(titleLine, 1);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^#[\w-]+#?$/.test(line.trim())) {
      tags.push(line.trim().replace(/#/g, ""));
      lines.splice(i, 1);
      i--;
    }
  }
  let body = lines.join("\n").replace(/^#[\w-]+(\s*#[\w-]+)*\s*$/gm, "").trim();
  if (tags.length === 0) return body;
  return `---\ntags: [${tags.map((t) => t.replace(/\s+/g, "-").toLowerCase()).join(", ")}]\n---\n\n${body}\n`;
}

function stripNotionFrontmatter(content: string): string {
  return content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^\w+:.*\n?/gm, "");
}

function csvToMarkdown(csv: string): string {
  const lines = csv.replace(/\r\n/g, "\n").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "";
  const rows = lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const out = ["", `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of body) {
    out.push(`| ${row.join(" | ")} |`);
  }
  return out.join("\n");
}

function flattenRoamJson(json: string): ConvertedNote[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const notes: ConvertedNote[] = [];
  const pages: Record<string, string> = {};
  function blocksToMd(blocks: unknown[], depth: number): string[] {
    const out: string[] = [];
    for (const b of blocks) {
      const r = b as { string?: string; children?: unknown[] };
      const text = (r.string ?? "").replace(/\(\([^)]*\)\)/g, "").trim();
      if (!text) {
        if (r.children) out.push(...blocksToMd(r.children, depth));
        continue;
      }
      const indent = "  ".repeat(depth);
      out.push(`${indent}- ${text}`);
      if (r.children) out.push(...blocksToMd(r.children, depth + 1));
    }
    return out;
  }
  function collect(obj: unknown) {
    if (Array.isArray(obj)) {
      for (const item of obj) collect(item);
      return;
    }
    if (obj && typeof obj === "object") {
      const r = obj as { title?: string; children?: unknown[] };
      const title = r.title ?? "untitled";
      if (Array.isArray(r.children)) {
        pages[title] = blocksToMd(r.children, 0).join("\n");
      }
    }
  }
  collect(data);
  for (const [title, md] of Object.entries(pages)) {
    const safe = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "untitled";
    notes.push({ relPath: `${safe}.md`, content: `# ${title}\n\n${md}\n` });
  }
  return notes;
}

const IMPORTERS: Record<ImportSource, Importer> = {
  plain: {
    accept: (rel, isDir) =>
      isDir ? rel !== "" : /\.(md|markdown|txt)$/i.test(rel),
    convert: async (abs, rel) => [{ relPath: rel, content: await readFile(abs, "utf8") }],
  },
  obsidian: {
    accept: (rel, isDir) => {
      if (rel.startsWith(".obsidian") || rel.includes("/.obsidian/")) return false;
      return isDir ? rel !== "" : /\.md$/i.test(rel);
    },
    convert: async (abs, rel) => [
      {
        relPath: rel,
        content: stripObsidianFrontmatter(wikiLinkToMarkdown(await readFile(abs, "utf8"))),
      },
    ],
    collectAttachments: async (abs) => {
      const content = await readFile(abs, "utf8");
      const out: Attachment[] = [];
      for (const m of content.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]]*)?\]\]/g)) {
        const target = (m[1] ?? "").trim();
        const from = join(resolve(abs, ".."), target);
        if (existsSync(from)) out.push({ from, to: target });
      }
      return out;
    },
  },
  bear: {
    accept: (rel, isDir) =>
      isDir ? rel !== "" : /\.(md|txt)$/i.test(rel),
    convert: async (abs, rel) => [
      {
        relPath: rel,
        content: bearHeaderToFrontmatter(await readFile(abs, "utf8")),
      },
    ],
  },
  roam: {
    accept: (rel, isDir) =>
      isDir ? rel !== "" : /\.(json|md)$/i.test(rel),
    convert: async (abs, rel) => {
      if (/\.json$/i.test(rel)) {
        return flattenRoamJson(await readFile(abs, "utf8"));
      }
      return [{ relPath: rel, content: wikiLinkToMarkdown(await readFile(abs, "utf8")) }];
    },
  },
  notion: {
    accept: (rel, isDir) => {
      if (rel.startsWith("_resources") || rel.includes("/_resources/")) return false;
      return isDir ? rel !== "" : /\.(md|csv)$/i.test(rel);
    },
    convert: async (abs, rel) => {
      if (/\.csv$/i.test(rel)) {
        return [{ relPath: rel.replace(/\.csv$/i, ".md"), content: csvToMarkdown(await readFile(abs, "utf8")) }];
      }
      const content = stripNotionFrontmatter(await readFile(abs, "utf8"))
        .replace(/\(([^)]*\.(png|jpg|jpeg|gif|svg|webp))\)/gi, "(./_resources/$1)");
      return [{ relPath: rel, content }];
    },
  },
};

function sourceName(source: ImportSource): string {
  return source;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function collectImports(
  source: ImportSource,
  root: string,
): Promise<{ notes: ConvertedNote[]; attachments: Attachment[]; sample: string[] }> {
  const importer = IMPORTERS[source];
  const all = await walkAll(root);
  const notes: ConvertedNote[] = [];
  const attachments: Attachment[] = [];
  const sample: string[] = [];
  for (const entry of all) {
    if (!importer.accept(entry.rel, entry.isDir)) continue;
    if (entry.isDir) continue;
    const converted = await importer.convert(entry.abs, entry.rel);
    if (converted) {
      for (const note of converted) {
        const relPath = normalizeRel(note.relPath, source);
        notes.push({ relPath, content: note.content });
        if (sample.length < 5) sample.push(`Imported/${sourceName(source)}/${relPath}`);
      }
    }
    if (importer.collectAttachments) {
      attachments.push(...(await importer.collectAttachments(entry.abs, entry.rel)));
    }
  }
  // Notion: copy the whole _resources dir as attachments.
  if (source === "notion") {
    const resourcesDir = join(root, "_resources");
    if (isDirectory(resourcesDir)) {
      for (const entry of await walkAll(resourcesDir)) {
        if (entry.isDir) continue;
        attachments.push({ from: entry.abs, to: `_resources/${entry.rel}` });
      }
    }
  }
  return { notes, attachments, sample };
}

export async function previewImport(source: ImportSource, path: string): Promise<ImportPreview> {
  const root = await resolveImportRoot(path);
  const { notes, attachments, sample } = await collectImports(source, root);
  return { source, notes: notes.length, attachments: attachments.length, sample };
}

export async function runImport(source: ImportSource, path: string): Promise<ImportResult> {
  const root = await resolveImportRoot(path);
  const { notes, attachments } = await collectImports(source, root);
  const created: string[] = [];
  const prefix = `Imported/${sourceName(source)}`;

  for (const note of notes) {
    const rel = `${prefix}/${note.relPath}`;
    const existing = await entryExists(rel);
    if (existing) continue;
    const out = await createEntry(rel, "file", note.content);
    created.push(out);
  }
  for (const att of attachments) {
    const rel = `${prefix}/${att.to.split(sep).join("/")}`;
    if (await entryExists(rel)) continue;
    try {
      const from = att.from.startsWith("/") ? att.from : resolve(root, att.from);
      const out = await createEntry(rel, "file", "");
      await copyFile(from, resolveSafe(out));
      created.push(out);
    } catch {
      // skip unreadable attachment
    }
  }

  if (created.length > 0) broadcaster.emitEvent({ type: "fs", paths: created });
  return { notes: notes.length, attachments: attachments.length, created };
}

async function resolveImportRoot(path: string): Promise<string> {
  if (!path) throw new Error("Import path is required");
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) throw new Error("Import path must be an absolute path");
  const full = resolve(trimmed);
  if (full.toLowerCase().endsWith(".zip")) {
    if (!existsSync(full)) throw new Error("Import file not found");
    return extractZip(full);
  }
  if (!isDirectory(full)) throw new Error("Import path must be a folder or a .zip file");
  return full;
}

async function extractZip(zipPath: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "persona-import-"));
  try {
    await execFileP("unzip", ["-q", zipPath, "-d", dir], { timeout: 120_000 });
    return dir;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Could not extract ${zipPath}: ${err instanceof Error ? err.message : "unzip failed"}`);
  }
}

async function entryExists(rel: string): Promise<boolean> {
  try {
    await stat(resolveSafe(rel));
    return true;
  } catch {
    return false;
  }
}
