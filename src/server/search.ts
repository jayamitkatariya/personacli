import { readFile } from "node:fs/promises";
import { resolveSafe, walkFiles } from "./fs.js";
import { listTasks } from "./tasks.js";
import { semanticSearch } from "./embeddings.js";
import type { SearchResults, TreeNode } from "../shared/types.js";

interface FileEntry {
  path: string;
  name: string;
  mtime: number;
}

let index: FileEntry[] = [];
let building = false;
let rebuildQueued = false;

export async function rebuildIndex() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  try {
    while (true) {
      rebuildQueued = false;
      try {
        index = await walkFiles();
      } catch {
        index = [];
      }
      if (!rebuildQueued) break;
    }
  } finally {
    building = false;
  }
}

/** Subsequence fuzzy score: 0 = no match, higher = better. */
function fuzzyScore(query: string, name: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 500;
  if (n.includes(q)) return 300;

  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      qi++;
      streak++;
      score += streak * 10;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

const SEARCHABLE_EXT = new Set([".md", ".txt", ".markdown"]);

export async function search(q: string, scope?: string): Promise<SearchResults> {
  const query = q.trim();
  if (!query) return { files: [], tasks: [], semantic: [] };

  const inScope = (path: string) =>
    !scope || path === scope || path.startsWith(scope.replace(/\/$/, "") + "/");
  const scoped = index.filter((e) => inScope(e.path));

  const scored = scoped
    .map((entry) => ({ entry, score: fuzzyScore(query, entry.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const files: TreeNode[] = scored.map(({ entry }) => ({
    name: entry.name,
    path: entry.path,
    type: "file",
    mtime: entry.mtime,
  }));

  if (files.length < 8 && query.length >= 3) {
    const dirs = new Set<string>();
    const results = new Map<string, TreeNode>();
    let matched = 0;
    for (const entry of scoped) {
      if (matched >= 8) break;
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (!SEARCHABLE_EXT.has(ext)) continue;
      const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      if (dirs.has(parent)) continue;
      try {
        const content = await readFile(resolveSafe(entry.path), "utf8");
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.set(entry.path, { name: entry.name, path: entry.path, type: "file", mtime: entry.mtime });
          matched++;
        }
        if (results.size >= 4) dirs.add(parent);
      } catch {
        // skip unreadable
      }
    }
    const contentMatches = [...results.values()];
    for (const m of contentMatches) {
      if (!files.find((f) => f.path === m.path)) files.push(m);
    }
    files.length = Math.min(files.length, 10);
  }

  const allTasks = await listTasks();
  const taskQuery = query.toLowerCase();
  const tasks = allTasks
    .filter(
      (t) =>
        t.title.toLowerCase().includes(taskQuery) ||
        t.project?.toLowerCase().includes(taskQuery),
    )
    .slice(0, 6);

  const semantic = (await semanticSearch(query)).filter((h) => inScope(h.path));

  return { files, tasks, semantic };
}
