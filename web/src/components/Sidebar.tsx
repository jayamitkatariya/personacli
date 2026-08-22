import { useMemo, useRef, useState } from "react";
import {
  Code2,
  PenLine,
  User,
  Plus,
  Search,
  Settings as SettingsIcon,
  FolderOpen,
  Folder,
  ChevronRight,
  Circle,
  Sunrise,
  FilePlus,
  FolderPlus,
  Hash,
  Pin,
  PinOff,
  File,
  FileQuestion,
  SquareCheck,
  MessageCircle,
  Timer,
  BookOpen,
} from "lucide-react";
import { useStore, type View } from "../state/store";
import type { ModuleKey, TreeNode } from "../../../src/shared/types";
import FileTree from "./FileTree";
import JournalModule from "./JournalModule";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 240;
const WIDTH_KEY = "persona.sidebar-width";

function storedSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const parsed = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
}

const TAB_DEFS: { id: "code" | "edit" | "profile"; icon: typeof Code2; label: string; view: View }[] = [
  { id: "code", icon: Code2, label: "Chat", view: "chat" },
  { id: "edit", icon: PenLine, label: "Write", view: "write" },
  { id: "profile", icon: User, label: "Tasks", view: "tasks" },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

export default function Sidebar() {
  const open = useStore((s) => s.sidebarOpen);
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const view = useStore((s) => s.view);
  const openSettings = useStore((s) => s.openSettings);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const [width, setWidth] = useState<number>(storedSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = width;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth.current + e.clientX - startX.current));
    setWidth(next);
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    localStorage.setItem(WIDTH_KEY, String(width));
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const resetWidth = () => {
    setWidth(DEFAULT_SIDEBAR_WIDTH);
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
  };

  if (!open) return null;

  return (
    <aside
      style={{ width }}
      className={`shrink-0 border-r border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-800 flex flex-col relative ${
        dragging ? "select-none" : ""
      }`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onDoubleClick={resetWidth}
        className={`absolute top-0 right-0 bottom-0 w-1.5 -mr-1.5 cursor-col-resize z-10 group ${
          dragging ? "bg-blue-400/60" : "hover:bg-blue-400/40"
        }`}
      >
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-stone-300 dark:bg-stone-600 group-hover:bg-blue-400" />
      </div>
      <div className="pt-4 pb-2 flex justify-center">
        <span className="gradient-text text-[15px] font-semibold tracking-tight select-none">
          Persona
        </span>
      </div>
      <div className="px-3 pb-2">
        <div className="rounded-lg bg-stone-100 dark:bg-stone-700/50 p-0.5 flex items-stretch">
          {TAB_DEFS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={t.label}
                className={`flex-1 h-7 rounded-md flex items-center justify-center transition-colors ${
                  active
                    ? "bg-white dark:bg-stone-700 shadow-sm text-stone-800 dark:text-stone-200"
                    : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2.2 : 2} />
              </button>
            );
          })}
        </div>
      </div>

      <ModuleNav />

      <PinboardSection />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === "write" && <WriteSidebarContent />}
        {(view === "chat" || view === "today") && <ChatSidebarContent />}
        {view === "tasks" && <TasksSidebarContent />}
      </div>

      <div className="border-t border-stone-200/80 dark:border-stone-800 px-3 py-2 flex items-center justify-between">
        <button
          onClick={openSettings}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-stone-600 dark:text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          Settings
        </button>
        <button
          onClick={toggleSidebar}
          title="Toggle sidebar (⌘⇧B)"
          className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-200"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------- */
/* Module nav (toggleable sidebar surfaces)                              */
/* -------------------------------------------------------------------- */

const MODULE_DEFS: { key: ModuleKey; icon: typeof Timer; label: string; view: View | null }[] = [
  { key: "focus", icon: Timer, label: "Focus", view: null },
  { key: "today", icon: Sunrise, label: "Today", view: "today" },
];

function ModuleNav() {
  const modules = useStore((s) => s.modules);
  const setView = useStore((s) => s.setView);
  const openFocus = useStore((s) => s.openFocus);

  const hasJournal = modules.journal !== false;
  const visible = MODULE_DEFS.filter((m) => modules[m.key] !== false);

  if (visible.length === 0 && !hasJournal) return null;

  return (
    <div className="px-2 pb-2 shrink-0 border-b border-stone-200/80 dark:border-stone-800">
      {hasJournal && <JournalModule />}
      {visible.length > 0 && (
        <div className="space-y-0.5 pt-1.5">
          {visible.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => (m.view ? setView(m.view) : openFocus())}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
              >
                <Icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" strokeWidth={1.8} />
                <span className="text-left">{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Pinboard (permanent — visible on every sidebar tab)                   */
/* -------------------------------------------------------------------- */

function PinboardSection() {
  const pins = useStore((s) => s.pins);
  const setView = useStore((s) => s.setView);
  const openDoc = useStore((s) => s.openDoc);
  const unpinFile = useStore((s) => s.unpinFile);
  const unpinTask = useStore((s) => s.unpinTask);

  const hasPins = pins.files.length + pins.tasks.length + pins.missing.length > 0;
  if (!hasPins) return null;

  return (
    <div className="px-2 pb-1 shrink-0 max-h-[40%] overflow-y-auto border-b border-stone-200/80 dark:border-stone-800">
      <SectionHeader title="Pinboard" icon={<Pin className="w-3 h-3 text-blue-500" />} />
      <div className="space-y-0.5 pt-0.5">
        {pins.files.map((file) => (
          <div
            key={`file:${file.path}`}
            className="group flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-md hover:bg-stone-50 dark:hover:bg-stone-700/60 cursor-pointer"
            onClick={() => {
              setView("write");
              void openDoc(file.path);
            }}
            title={file.path}
          >
            <File className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" strokeWidth={1.8} />
            <span className="flex-1 text-left truncate text-[12.5px] text-stone-700 dark:text-stone-300">
              {file.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void unpinFile(file.path);
              }}
              title="Unpin"
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200/70 dark:hover:bg-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
            >
              <PinOff className="w-3 h-3" />
            </button>
          </div>
        ))}
        {pins.tasks.map((task) => (
          <div
            key={`task:${task.id}`}
            className="group flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-md hover:bg-stone-50 dark:hover:bg-stone-700/60 cursor-pointer"
            onClick={() => setView("tasks")}
            title={task.title}
          >
            {task.status === "done" ? (
              <SquareCheck className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : (
              <Circle className="w-3 h-3 text-stone-300 dark:text-stone-500 shrink-0" strokeWidth={2} />
            )}
            <span
              className={`flex-1 text-left truncate text-[12.5px] ${
                task.status === "done"
                  ? "text-stone-400 dark:text-stone-500 line-through"
                  : "text-stone-700 dark:text-stone-300"
              }`}
            >
              {task.title}
            </span>
            {task.project && <span className="text-[10px] text-blue-600 shrink-0">#{task.project}</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                void unpinTask(task.id);
              }}
              title="Unpin"
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200/70 dark:hover:bg-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
            >
              <PinOff className="w-3 h-3" />
            </button>
          </div>
        ))}
        {pins.missing.map((pin) => (
          <div
            key={`missing:${pin.type}:${pin.ref}`}
            className="group flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-md hover:bg-stone-50 dark:hover:bg-stone-700/60"
            title={`${pin.type === "file" ? "File" : "Task"} no longer exists — unpin to remove`}
          >
            <FileQuestion className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />
            <span className="flex-1 text-left truncate text-[12.5px] text-stone-400 dark:text-stone-500 italic">
              {pin.ref.split("/").pop()}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void (pin.type === "file" ? unpinFile(pin.ref) : unpinTask(pin.ref));
              }}
              title="Unpin"
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200/70 dark:hover:bg-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
            >
              <PinOff className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Chat sidebar                                                          */
/* -------------------------------------------------------------------- */

function ChatSidebarContent() {
  const setView = useStore((s) => s.setView);
  const startNewChat = useStore((s) => s.startNewChat);
  const loadChat = useStore((s) => s.loadChat);
  const chats = useStore((s) => s.chats);
  const currentChatId = useStore((s) => s.currentChatId);
  const tree = useStore((s) => s.tree);
  const tasks = useStore((s) => s.tasks);
  const toggleExpand = useStore((s) => s.toggleExpand);

  const todoTasks = useMemo(
    () => tasks.filter((t) => t.status === "todo").slice(0, 5),
    [tasks],
  );

  const projects = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const node of tree) {
      if (node.type === "folder") {
        map.set(node.path, { name: node.name, count: countFiles(node) });
      }
    }
    if (!map.size) {
      for (const t of tasks) {
        const key = t.project ?? "Personal";
        const entry = map.get(key);
        if (entry) entry.count++;
        else map.set(key, { name: key, count: 1 });
      }
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [tree, tasks]);

  const openProject = (id: string) => {
    setView("write");
    const store = useStore.getState();
    if (store.expanded[id]) return;
    // Expand the folder and every ancestor so it is visible in the tree.
    const parts = id.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!useStore.getState().expanded[p]) useStore.getState().toggleExpand(p);
    }
  };

  return (
    <div className="px-2 space-y-3">
      <div className="space-y-0.5">
        <button
          onClick={() => startNewChat()}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <Plus className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400 dark:text-stone-500" />
          <span>New Chat</span>
        </button>
        <button
          onClick={() => setView("today")}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <Sunrise className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
          <span>Today&apos;s Stuff</span>
        </button>
      </div>

      {chats.length > 0 && (
        <>
          <SectionHeader title="Recent chats" />
          <div className="space-y-0.5">
            {chats.slice(0, 8).map((c) => (
              <button
                key={c.id}
                onClick={() => void loadChat(c.id)}
                title={c.preview}
                className={`w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-[12.5px] hover:bg-stone-50 dark:hover:bg-stone-700/60 text-left ${
                  currentChatId === c.id
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-stone-600 dark:text-stone-400"
                }`}
              >
                <MessageCircle className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" strokeWidth={1.8} />
                <span className="flex-1 text-left truncate">{c.title}</span>
                <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0">
                  {relativeTime(new Date(c.updatedAt).toISOString())}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <SectionHeader title="Projects" icon={<FolderOpen className="w-3 h-3" />} />
      <div className="space-y-0.5">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => openProject(p.id)}
            className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-[12.5px] text-stone-600 dark:text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-700/60/60"
          >
            <Folder className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
            <span className="flex-1 text-left truncate">{p.name}</span>
            <span className="text-[10px] text-stone-400 dark:text-stone-500">{p.count}</span>
          </button>
        ))}
      </div>

      {todoTasks.length > 0 && (
        <>
          <SectionHeader title="Recent" />
          <div className="space-y-0.5">
            {todoTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => setView("tasks")}
                className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-[12px] text-stone-600 dark:text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-700/60/60"
              >
                <Circle className="w-3 h-3 text-stone-300 dark:text-stone-600 dark:text-stone-400 dark:text-stone-500 shrink-0" strokeWidth={2} />
                <span className="flex-1 text-left truncate">{t.title}</span>
                <span className="text-[10px] text-stone-400 dark:text-stone-500">{relativeTime(t.updated)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Write sidebar                                                          */
/* -------------------------------------------------------------------- */

function WriteSidebarContent() {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 space-y-0.5 shrink-0">
        <button
          onClick={() => setCreating("file")}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <FilePlus className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
          <span>New file</span>
        </button>
        <button
          onClick={() => setCreating("folder")}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <FolderPlus className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
          <span>New folder</span>
        </button>
      </div>

      <div className="px-2 pt-2 shrink-0">
        <SectionHeader title="Workspace" />
      </div>

      {!creating && (
        <div className="px-2 pb-1 shrink-0 relative">
          <Search className="w-3.5 h-3.5 absolute left-[18px] top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
          <input
            value={filter}
            placeholder="Filter…"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFilter("");
            }}
            className="w-full pl-7 pr-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/50 text-[12px] outline-none focus:border-blue-400 focus:bg-white dark:focus:bg-stone-800"
          />
        </div>
      )}

      <FileTree
        filter={filter}
        creating={creating}
        onCreateDone={(path) => {
          setCreating(null);
          if (path.includes(".")) void useStore.getState().openDoc(path);
        }}
        onCancelCreate={() => setCreating(null)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Tasks sidebar                                                          */
/* -------------------------------------------------------------------- */

function TasksSidebarContent() {
  const tasks = useStore((s) => s.tasks);
  const setView = useStore((s) => s.setView);
  const setProjectFilter = useStore((s) => s.setTaskProjectFilter);
  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.project) set.add(t.project);
    return ["All", ...Array.from(set).sort()];
  }, [tasks]);
  return (
    <div className="px-2 space-y-3">
      <SectionHeader title="Projects" icon={<Hash className="w-3 h-3" />} />
      <div className="space-y-0.5">
        {projects.map((p) => (
          <button
            key={p}
            onClick={() => {
              setProjectFilter(p === "All" ? null : p);
              setView("tasks");
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-[12.5px] text-stone-600 dark:text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-700/60/60"
          >
            <Folder className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
            <span className="flex-1 text-left">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Helpers                                                                */
/* -------------------------------------------------------------------- */

function SectionHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-2">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {title}
      </span>
    </div>
  );
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}
