import { EventEmitter } from "node:events";
import { join, relative } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { getWorkspace } from "./state.js";
import { rebuildIndex } from "./search.js";
import { updateSemanticIndex } from "./embeddings.js";
import type { ServerEvent } from "../shared/types.js";

type Listener = (event: ServerEvent) => void;

class Broadcaster extends EventEmitter {
  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }
  subscribe(listener: Listener): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export const broadcaster = new Broadcaster();

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFsPaths: string[] = [];
let pendingOther: ServerEvent | null = null;

function schedule(event: ServerEvent) {
  if (event.type === "fs") {
    pendingFsPaths = [...new Set([...pendingFsPaths, ...event.paths])];
  } else {
    pendingOther = event;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Flush both kinds of pending events — an fs change and a task change
    // landing in the same window must both reach the client. pendingFsPaths
    // is left intact for scheduleIndexRebuild to consume.
    if (pendingFsPaths.length > 0) {
      broadcaster.emitEvent({ type: "fs", paths: pendingFsPaths });
    }
    if (pendingOther) {
      broadcaster.emitEvent(pendingOther);
      pendingOther = null;
    }
    debounceTimer = null;
  }, 120);
}

function scheduleIndexRebuild() {
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    const paths = pendingFsPaths;
    pendingFsPaths = [];
    void rebuildIndex();
    void updateSemanticIndex(paths);
    indexTimer = null;
  }, 500);
}

export function startWatcher() {
  const workspace = getWorkspace();
  if (!workspace || watcher) return;
  const tasksDir = join(workspace, ".persona", "tasks");

  const personaDir = join(workspace, ".persona");

  watcher = watch(workspace, {
    ignoreInitial: true,
    ignored: (path: string) => {
      const name = path.split("/").pop() ?? "";
      if (name === ".git" || name === "node_modules") return true;
      // Ignore Persona's own metadata (pins, embeddings index) so writes to
      // them never trigger fs events or index rebuilds. Only descendants of
      // .persona are pruned — the .persona dir itself and the tasks subtree
      // stay watched so task changes still emit `tasks` events.
      if (path.startsWith(personaDir + "/") && !path.startsWith(tasksDir)) return true;
      return false;
    },
    depth: 12,
  });

  watcher.on("all", (_event: string, path: string) => {
    if (path.startsWith(tasksDir)) {
      schedule({ type: "tasks" });
    } else {
      const rel = workspace ? relative(workspace, path) : path;
      schedule({ type: "fs", paths: [rel] });
      scheduleIndexRebuild();
    }
  });
}

export function stopWatcher() {
  watcher?.close();
  watcher = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (indexTimer) clearTimeout(indexTimer);
  debounceTimer = null;
  indexTimer = null;
  pendingFsPaths = [];
  pendingOther = null;
}
