import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Pin, Pinboard, Task, TreeNode } from "../shared/types.js";
import { readTree, workspaceRoot } from "./fs.js";
import { listTasks } from "./tasks.js";

function pinsPath(): string {
  return join(workspaceRoot(), ".persona", "pins.json");
}

function readPins(): Pin[] {
  try {
    if (!existsSync(pinsPath())) return [];
    const data = JSON.parse(readFileSync(pinsPath(), "utf8")) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (p): p is Pin =>
        !!p &&
        (p.type === "file" || p.type === "task") &&
        typeof (p as Pin).ref === "string",
    );
  } catch {
    return [];
  }
}

function writePins(pins: Pin[]) {
  mkdirSync(join(workspaceRoot(), ".persona"), { recursive: true });
  writeFileSync(pinsPath(), JSON.stringify(pins, null, 2));
}

export function addPin(type: Pin["type"], ref: string): boolean {
  const pins = readPins();
  if (pins.some((p) => p.type === type && p.ref === ref)) return false;
  pins.push({ type, ref, addedAt: Date.now() });
  writePins(pins);
  return true;
}

export function removePin(type: Pin["type"], ref: string): boolean {
  const pins = readPins();
  const next = pins.filter((p) => !(p.type === type && p.ref === ref));
  if (next.length === pins.length) return false;
  writePins(next);
  return true;
}

/**
 * Rewrite file-pin refs after a rename/move so the pinboard follows the file
 * instead of marking it missing. Folder moves retarget every file pin inside.
 */
export function retargetPins(from: string, to: string): void {
  if (!from || from === to) return;
  const pins = readPins();
  let changed = false;
  const next = pins.map((p) => {
    if (p.type !== "file") return p;
    let ref: string | null = null;
    if (p.ref === from) ref = to;
    else if (p.ref.startsWith(from + "/")) ref = to + p.ref.slice(from.length);
    if (ref === null || ref === p.ref) return p;
    changed = true;
    return { ...p, ref };
  });
  if (changed) writePins(next);
}

function collectFiles(nodes: TreeNode[], map: Map<string, TreeNode>) {
  for (const node of nodes) {
    if (node.type === "file") map.set(node.path, node);
    else if (node.children) collectFiles(node.children, map);
  }
}

/** Resolve stored pins to live files/tasks, flagging anything that disappeared. */
export async function getPinboard(): Promise<Pinboard> {
  const pins = readPins();
  const files = new Map<string, TreeNode>();
  const tasksById = new Map<string, Task>();

  try {
    collectFiles(await readTree(), files);
  } catch {
    // workspace unavailable — everything resolves as missing
  }
  for (const task of await listTasks()) tasksById.set(task.id, task);

  const filePins: TreeNode[] = [];
  const taskPins: Task[] = [];
  const missing: Pin[] = [];
  for (const pin of pins) {
    if (pin.type === "file") {
      const node = files.get(pin.ref);
      if (node) filePins.push(node);
      else missing.push(pin);
    } else {
      const task = tasksById.get(pin.ref);
      if (task) taskPins.push(task);
      else missing.push(pin);
    }
  }
  return { files: filePins, tasks: taskPins, missing };
}
