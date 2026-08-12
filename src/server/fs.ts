import {
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
  rename,
  rm,
  copyFile,
  access,
} from "node:fs/promises";
import { join, resolve, relative, dirname, basename, extname, sep } from "node:path";
import type { TreeNode } from "../shared/types.js";
import { getWorkspace } from "./state.js";

export class FsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const IGNORED_DIRS = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

export function workspaceRoot(): string {
  const ws = getWorkspace();
  if (!ws) throw new FsError(503, "Workspace not configured");
  return resolve(ws);
}

/** Resolve a workspace-relative path and ensure it stays inside the workspace. */
export function resolveSafe(wsPath: string): string {
  const root = workspaceRoot();
  const full = resolve(root, wsPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new FsError(400, "Path escapes workspace");
  }
  return full;
}

export function toRelative(fullPath: string): string {
  const root = workspaceRoot();
  return relative(root, fullPath);
}

function shouldIgnore(name: string, isDir: boolean): boolean {
  if (isDir && (name.startsWith(".") || IGNORED_DIRS.has(name))) return true;
  if (name.startsWith(".")) return true;
  return false;
}

export async function readTree(rootPath?: string, depth = 0): Promise<TreeNode[]> {
  const root = rootPath ? resolveSafe(rootPath) : workspaceRoot();
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (shouldIgnore(entry.name, entry.isDirectory())) continue;
    const full = join(root, entry.name);
    const rel = toRelative(full);
    const node: TreeNode = {
      name: entry.name,
      path: rel.split(sep).join("/"),
      type: entry.isDirectory() ? "folder" : "file",
    };
    if (entry.isDirectory()) {
      if (depth < 8) node.children = await readTree(rel, depth + 1);
    } else {
      try {
        const s = await stat(full);
        node.size = s.size;
        node.mtime = s.mtimeMs;
      } catch {
        // skip
      }
    }
    nodes.push(node);
  }
  return nodes;
}

export async function readFileContent(wsPath: string): Promise<string> {
  const full = resolveSafe(wsPath);
  const s = await stat(full).catch(() => {
    throw new FsError(404, "File not found");
  });
  if (!s.isFile()) throw new FsError(400, "Not a file");
  if (s.size > MAX_CONTENT_BYTES) throw new FsError(413, "File too large to open");
  return readFile(full, "utf8");
}

export async function writeFileContent(wsPath: string, content: string) {
  const full = resolveSafe(wsPath);
  const s = await stat(full).catch(() => {
    throw new FsError(404, "File not found");
  });
  if (!s.isFile()) throw new FsError(400, "Not a file");
  await writeFile(full, content, "utf8");
}

async function ensureUniqueName(dir: string, name: string, isDir: boolean): Promise<string> {
  const base = basename(name, extname(name));
  const ext = extname(name);
  let candidate = name;
  let i = 2;
  while (true) {
    try {
      await access(join(dir, candidate));
    } catch {
      return candidate;
    }
    candidate = `${base} ${i}${ext}`;
    if (isDir) candidate = `${base} ${i}`;
    i++;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function createEntry(wsPath: string, type: "file" | "folder", content = "") {
  const full = resolveSafe(wsPath);
  const parent = dirname(full);
  const name = basename(full);
  await mkdir(parent, { recursive: true });
  const finalName = await ensureUniqueName(parent, name, type === "folder");
  const finalFull = join(parent, finalName);
  if (type === "folder") {
    await mkdir(finalFull);
  } else {
    await writeFile(finalFull, content, "utf8");
  }
  return toRelative(finalFull).split(sep).join("/");
}

export async function renameEntry(wsPath: string, newName: string) {
  const full = resolveSafe(wsPath);
  const parent = dirname(full);
  if (!newName || newName.includes("/") || newName.includes("..") || newName === ".") {
    throw new FsError(400, "Invalid name");
  }
  const dest = join(parent, newName);
  if (dest === full) {
    return toRelative(full).split(sep).join("/");
  }
  if (await exists(dest)) {
    throw new FsError(409, `"${newName}" already exists in this folder`);
  }
  await rename(full, dest);
  return toRelative(dest).split(sep).join("/");
}

export async function moveEntries(paths: string[], targetDir: string) {
  const root = workspaceRoot();
  const targetFull = resolveSafe(targetDir);
  const targetStat = await stat(targetFull).catch(() => {
    throw new FsError(400, "Destination folder not found");
  });
  if (!targetStat.isDirectory()) throw new FsError(400, "Destination is not a folder");
  const moved: string[] = [];
  for (const wsPath of paths) {
    const full = resolveSafe(wsPath);
    if (dirname(full) === targetFull) {
      // already in the destination folder — nothing to do
      moved.push(toRelative(full).split(sep).join("/"));
      continue;
    }
    if (targetFull === full || targetFull.startsWith(full + sep)) {
      throw new FsError(400, "Cannot move into itself");
    }
    const name = basename(full);
    const dest = join(targetFull, name);
    if (await exists(dest)) {
      throw new FsError(409, `"${name}" already exists in the destination folder`);
    }
    await rename(full, dest);
    moved.push(toRelative(dest).split(sep).join("/"));
  }
  return moved;
}

export async function duplicateEntry(wsPath: string) {
  const full = resolveSafe(wsPath);
  const parent = dirname(full);
  const name = basename(full);
  const isDir = (await stat(full)).isDirectory();
  const copyName = await ensureUniqueName(parent, `Copy of ${name}`, isDir);
  const dest = join(parent, copyName);
  if (isDir) {
    await copyDir(full, dest);
  } else {
    await copyFile(full, dest);
  }
  return toRelative(dest).split(sep).join("/");
}

async function copyDir(src: string, dest: string) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

export async function deleteEntry(wsPath: string) {
  const full = resolveSafe(wsPath);
  if (full === workspaceRoot()) {
    throw new FsError(400, "Cannot delete the workspace root");
  }
  await rm(full, { recursive: true, force: true });
}

/** True when a file or folder exists at the workspace-relative path. */
export async function entryExists(wsPath: string): Promise<boolean> {
  const full = resolveSafe(wsPath);
  try {
    await access(full);
    return true;
  } catch {
    return false;
  }
}

/** Walk the workspace collecting file paths (for search). Skips hidden dirs except .persona. */
export async function walkFiles(): Promise<{ path: string; name: string; mtime: number }[]> {
  const root = workspaceRoot();
  const results: { path: string; name: string; mtime: number }[] = [];
  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldIgnore(entry.name, true)) continue;
        await walk(join(dir, entry.name), join(rel, entry.name));
      } else {
        if (shouldIgnore(entry.name, false)) continue;
        try {
          const s = await stat(join(dir, entry.name));
          results.push({
            path: join(rel, entry.name).split(sep).join("/"),
            name: entry.name,
            mtime: s.mtimeMs,
          });
        } catch {
          // skip
        }
      }
    }
  }
  await walk(root, "");
  return results;
}
