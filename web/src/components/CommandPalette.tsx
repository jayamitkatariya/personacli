import { useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  FilePlus,
  SquareCheck,
  Sparkles,
  Settings as SettingsIcon,
  Search,
  File,
  Zap,
  Calendar,
  Tag,
  Flag,
  Sun,
  Moon,
  Monitor,
  Palette,
  BookOpen,
  PenLine,
  Trash2,
  Copy,
  Clipboard,
  Pin,
  PinOff,
  X,
  RefreshCw,
  FolderOpen,
  Volume2,
  VolumeX,
  RotateCcw,
  FileDown,
  FileText,
  MessageSquarePlus,
  Sunrise,
  PanelLeft,
  Circle,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore, type View } from "../state/store";
import { api } from "../lib/api";
import { sounds, soundsEnabled, setSoundsEnabled } from "../lib/sounds";
import type { ChatSearchHit, ParsedTask, SemanticHit, Settings, Task, TreeNode } from "../../../src/shared/types";

type Theme = Settings["theme"];

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const VIEW_OPTIONS: { value: View; label: string; icon: LucideIcon }[] = [
  { value: "write", label: "Write", icon: PenLine },
  { value: "today", label: "Today's Stuff", icon: Sunrise },
  { value: "tasks", label: "Tasks", icon: SquareCheck },
  { value: "chat", label: "Chat", icon: Sparkles },
];

const GROUP_ORDER = ["Views", "Current note", "Tasks", "Global"] as const;

interface ActionItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string[];
  group?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

interface ParamOption {
  value: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
}

/** An action that takes an argument typed in the palette, e.g. "set theme dark". */
interface ParamAction {
  id: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  prefixes: string[];
  options?: ParamOption[];
  freeText?: boolean;
  labelFor?: (arg: string) => string;
  run: (value: string) => void;
}

function paramCandidates(query: string, actions: ParamAction[]): ActionItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const items: ActionItem[] = [];
  for (const action of actions) {
    let arg: string | null = null;
    for (const prefix of action.prefixes) {
      if (q === prefix || q.startsWith(prefix + " ")) {
        arg = q.slice(prefix.length).trim();
        break;
      }
      if (prefix.startsWith(q)) {
        arg = "";
        break;
      }
    }
    if (arg === null) continue;
    if (action.options) {
      const opts = action.options.filter(
        (o) => o.label.toLowerCase().includes(arg) || o.value.includes(arg),
      );
      for (const o of opts) {
        items.push({
          id: `${action.id}:${o.value}`,
          label: `${action.label}: ${o.label}`,
          icon: o.icon,
          hint: o.current ? "current" : action.hint,
          run: () => action.run(o.value),
        });
      }
    } else if (action.freeText) {
      const text = arg;
      items.push({
        id: `${action.id}:text`,
        label: action.labelFor ? action.labelFor(text) : text ? `${action.label}: ${text}` : action.label,
        icon: action.icon,
        hint: text ? action.hint : undefined,
        disabled: !text,
        run: () => text && action.run(text),
      });
    }
  }
  return items;
}

function actionScore(label: string, keywords: string[] | undefined, q: string): number {
  const l = label.toLowerCase();
  if (l === q) return 6;
  if (l.startsWith(q)) return 4;
  if (l.split(/[\s…:/&-]+/).some((w) => w.startsWith(q))) return 3;
  if (l.includes(q)) return 2;
  for (const k of keywords ?? []) {
    if (k.startsWith(q)) return 3.5;
    if (k.includes(q)) return 2.5;
  }
  return 0;
}

function completePrefix(query: string, actions: ParamAction[]): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  const matches = new Set<string>();
  for (const action of actions) {
    for (const prefix of action.prefixes) {
      if (prefix.length > q.length && prefix.startsWith(q)) matches.add(prefix);
    }
  }
  if (matches.size !== 1) return null;
  return [...matches][0] + " ";
}

export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const mode = useStore((s) => s.paletteMode);
  const paletteScope = useStore((s) => s.paletteScope);
  const closePalette = useStore((s) => s.closePalette);
  const openPalette = useStore((s) => s.openPalette);
  const setView = useStore((s) => s.setView);
  const loadChat = useStore((s) => s.loadChat);
  const startNewChat = useStore((s) => s.startNewChat);
  const openSettings = useStore((s) => s.openSettings);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const focusTaskComposer = useStore((s) => s.focusTaskComposer);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const settings = useStore((s) => s.settings);
  const reloadSettings = useStore((s) => s.reloadSettings);
  const tree = useStore((s) => s.tree);
  const triggerConfetti = useStore((s) => s.triggerConfetti);
  const view = useStore((s) => s.view);
  const docs = useStore((s) => s.docs);
  const activeDocPath = useStore((s) => s.activeDocPath);
  const pins = useStore((s) => s.pins);
  const messages = useStore((s) => s.messages);
  const projectFilter = useStore((s) => s.taskProjectFilter);
  const suggestAndApplyTags = useStore((s) => s.suggestAndApplyTags);
  const closeDoc = useStore((s) => s.closeDoc);
  const refreshTree = useStore((s) => s.refreshTree);
  const pinFile = useStore((s) => s.pinFile);
  const unpinFile = useStore((s) => s.unpinFile);
  const openFocus = useStore((s) => s.openFocus);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ files: TreeNode[]; tasks: Task[]; semantic: SemanticHit[] }>({
    files: [],
    tasks: [],
    semantic: [],
  });
  const [chatHits, setChatHits] = useState<ChatSearchHit[]>([]);
  const [parsedTask, setParsedTask] = useState<ParsedTask | null>(null);

  const q = query.trim().toLowerCase();
  const journal = q.startsWith("jrnl");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // Escape must close the palette even when focus was stolen away from the
  // input (e.g. a Radix menu that opened it restores focus on close).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePalette();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closePalette]);

  useEffect(() => {
    if (journal || !query.trim()) {
      setResults({ files: [], tasks: [], semantic: [] });
      setChatHits([]);
      setParsedTask(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const [searchRes, parsed, chatRes] = await Promise.all([
          api.search(query, paletteScope ?? undefined),
          api.parseTask(query).catch(() => null),
          mode === "search" ? api.searchChats(query).catch(() => []) : Promise.resolve([]),
        ]);
        setResults(searchRes);
        setChatHits(chatRes);
        setParsedTask(parsed);
      } catch {
        setResults({ files: [], tasks: [], semantic: [] });
        setChatHits([]);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [query, journal, paletteScope, mode]);

  const openFile = async (path: string) => {
    closePalette();
    setView("write");
    const store = useStore.getState();
    await store.openDoc(path);
  };

  const createTask = async () => {
    if (!parsedTask) return;
    closePalette();
    try {
      await api.createTask(query);
      sounds.pop();
      await refreshTasks();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const appendJournal = async (text: string) => {
    closePalette();
    try {
      await api.journalAppend(text);
      sounds.success();
      triggerConfetti();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const setTheme = async (value: Theme) => {
    closePalette();
    try {
      await api.saveSettings({ theme: value });
      await reloadSettings();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const toggleTask = async (task: Task) => {
    const done = task.status === "todo";
    try {
      await api.updateTask(task.id, { status: done ? "done" : "todo" });
      await refreshTasks();
      if (done) sounds.chime();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const exportNote = (format: "pdf" | "docx") => {
    if (!activeDocPath) return;
    closePalette();
    const current = docs.find((d) => d.path === activeDocPath);
    void api
      .exportNote(activeDocPath, format, current?.content ?? undefined)
      .catch((e) => alert((e as Error).message));
  };

  const exportTasks = (format: "pdf" | "docx") => {
    closePalette();
    void api.exportTasks(format, projectFilter).catch((e) => alert((e as Error).message));
  };

  const exportCurrent = (format: "pdf" | "docx") => {
    if (activeDocPath) exportNote(format);
    else exportTasks(format);
  };

  const duplicateNote = async () => {
    if (!activeDocPath) return;
    closePalette();
    try {
      await api.duplicateEntry(activeDocPath);
      await refreshTree();
      sounds.pop();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const deleteNote = () => {
    if (!activeDocPath) return;
    if (!confirm(`Delete "${activeDocPath}"?`)) return;
    closePalette();
    void api
      .deleteEntry(activeDocPath)
      .then(() => {
        closeDoc(activeDocPath);
        void refreshTree();
      })
      .catch((e) => alert((e as Error).message));
  };

  const togglePin = () => {
    if (!activeDocPath) return;
    closePalette();
    const pinned = pins.files.some((f) => f.path === activeDocPath);
    if (pinned) void unpinFile(activeDocPath);
    else void pinFile(activeDocPath);
  };

  const copyPath = () => {
    if (!activeDocPath) return;
    closePalette();
    void navigator.clipboard.writeText(activeDocPath).catch(() => {});
  };

  const switchWorkspace = async () => {
    closePalette();
    try {
      const { path } = await api.pickFolder();
      if (path) {
        await api.saveSettings({ workspace: path });
        await reloadSettings();
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const activeDoc = docs.find((d) => d.path === activeDocPath) ?? null;
  const isTextDoc = activeDoc?.kind === "text";
  const hasAi = Boolean(settings?.ai.hasKey || settings?.ai.local);
  const pinnedFile = Boolean(activeDocPath && pins.files.some((f) => f.path === activeDocPath));
  const soundsOn = soundsEnabled();

  const paramActions = buildParamActions();

  const actions = buildActions();
  if (!open) return null;

  function buildParamActions(): ParamAction[] {
    const list: ParamAction[] = [
      {
        id: "set-theme",
        label: "Set theme",
        icon: Palette,
        hint: "light · dark · system",
        prefixes: ["set theme", "theme", "set"],
        options: THEME_OPTIONS.map((o) => ({ ...o, current: settings?.theme === o.value })),
        run: (value) => void setTheme(value as Theme),
      },
      {
        id: "go-view",
        label: "Go to",
        icon: PenLine,
        hint: "write · tasks · chat",
        prefixes: ["go", "go to", "view", "switch to"],
        options: VIEW_OPTIONS.map((o) => ({ ...o, current: view === o.value })),
        run: (value) => {
          closePalette();
          setView(value as View);
        },
      },
      {
        id: "export",
        label: "Export as",
        icon: FileDown,
        hint: activeDocPath ? "current note" : "task list",
        prefixes: ["export", "export as"],
        options: [
          { value: "pdf", label: "PDF", icon: FileDown },
          { value: "docx", label: "DOCX", icon: FileText },
        ],
        run: (value) => exportCurrent(value as "pdf" | "docx"),
      },
      {
        id: "sounds",
        label: "Sound effects",
        icon: soundsOn ? Volume2 : VolumeX,
        hint: "on · off",
        prefixes: ["sounds", "sound", "sfx"],
        options: [
          { value: "on", label: "On", icon: Volume2, current: soundsOn },
          { value: "off", label: "Off", icon: VolumeX, current: !soundsOn },
        ],
        run: (value) => {
          closePalette();
          setSoundsEnabled(value === "on");
          if (value === "on") sounds.tick();
        },
      },
      {
        id: "new-file",
        label: "New file",
        icon: FilePlus,
        hint: "plain filename",
        prefixes: ["new file"],
        freeText: true,
        labelFor: (arg) => (arg ? `Create file: ${arg}` : "New file…"),
        run: async (name) => {
          if (!/^[^/]+$/.test(name)) {
            alert("File names can't contain slashes.");
            return;
          }
          closePalette();
          try {
            const res = await api.createEntry(name.trim(), "file");
            await refreshTree();
            await useStore.getState().openDoc(res.path);
            setView("write");
            sounds.pop();
          } catch (e) {
            alert((e as Error).message);
          }
        },
      },
    ];
    if (mode === "commands" || journal) {
      list.push({
        id: "journal",
        label: "Log to journal",
        icon: BookOpen,
        hint: "timestamped",
        prefixes: ["jrnl", "journal"],
        freeText: true,
        labelFor: (arg) => (arg ? `Log to journal: ${arg}` : "Log to journal…"),
        run: (text) => void appendJournal(text),
      });
    }
    return list;
  }

  function buildActions(): ActionItem[] {
      const list: ActionItem[] = [
        {
          id: "view-write",
          label: "Write",
          hint: "⌘1",
          icon: PenLine,
          group: "Views",
          keywords: ["view", "note", "editor"],
          run: () => {
            closePalette();
            setView("write");
          },
        },
        {
          id: "view-tasks",
          label: "Tasks",
          hint: "⌘2",
          icon: SquareCheck,
          group: "Views",
          keywords: ["view", "todo"],
          run: () => {
            closePalette();
            setView("tasks");
          },
        },
        {
          id: "view-chat",
          label: "Chat",
          hint: "⌘3",
          icon: Sparkles,
          group: "Views",
          keywords: ["view", "ask", "assistant"],
          run: () => {
            closePalette();
            setView("chat");
          },
        },
      ];
      if (messages.length > 0) {
        list.push({
          id: "new-chat",
          label: "New chat",
          icon: MessageSquarePlus,
          group: "Views",
          keywords: ["clear", "reset", "start over"],
          run: () => {
            closePalette();
            startNewChat();
            setView("chat");
          },
        });
      }
      if (activeDocPath) {
        list.push(
          {
            id: "export-note-pdf",
            label: "Export note as PDF",
            icon: FileDown,
            group: "Current note",
            keywords: ["pdf", "download"],
            run: () => exportNote("pdf"),
          },
          {
            id: "export-note-docx",
            label: "Export note as DOCX",
            icon: FileText,
            group: "Current note",
            keywords: ["docx", "word", "download"],
            run: () => exportNote("docx"),
          },
          {
            id: "pin-note",
            label: pinnedFile ? "Unpin note" : "Pin note",
            icon: pinnedFile ? PinOff : Pin,
            group: "Current note",
            keywords: ["pin", "pinned", "star", "pinboard"],
            run: togglePin,
          },
          {
            id: "copy-path",
            label: "Copy note path",
            icon: Clipboard,
            group: "Current note",
            keywords: ["copy", "path", "clipboard"],
            run: copyPath,
          },
          {
            id: "duplicate-note",
            label: "Duplicate note",
            icon: Copy,
            group: "Current note",
            keywords: ["copy", "clone"],
            run: () => void duplicateNote(),
          },
          {
            id: "close-tab",
            label: "Close tab",
            hint: "⌘W",
            icon: X,
            group: "Current note",
            keywords: ["close", "tab", "document"],
            run: () => {
              closePalette();
              closeDoc(activeDocPath);
            },
          },
        );
        if (isTextDoc && hasAi) {
          list.push({
            id: "suggest-tags",
            label: "Suggest AI tags",
            icon: Sparkles,
            group: "Current note",
            keywords: ["tags", "tag", "ai", "classify"],
            run: () => {
              closePalette();
              void suggestAndApplyTags(activeDocPath);
            },
          });
        }
        list.push({
          id: "delete-note",
          label: "Delete note…",
          icon: Trash2,
          group: "Current note",
          keywords: ["delete", "remove", "trash"],
          danger: true,
          run: deleteNote,
        });
      }
      list.push(
        {
          id: "focus",
          label: "Start focus session",
          hint: "pick tasks & timer",
          icon: Timer,
          group: "Tasks",
          keywords: ["focus", "pomodoro", "timer", "deep work", "concentrate", "flow"],
          run: () => {
            closePalette();
            openFocus();
          },
        },
        {
          id: "new-task",
          label: "New task",
          hint: "⌘⇧N",
          icon: SquareCheck,
          group: "Tasks",
          keywords: ["todo", "add"],
          run: () => {
            closePalette();
            setView("tasks");
            focusTaskComposer();
          },
        },
        {
          id: "export-tasks-pdf",
          label: "Export tasks as PDF",
          icon: FileDown,
          group: "Tasks",
          keywords: ["pdf", "download"],
          run: () => exportTasks("pdf"),
        },
        {
          id: "export-tasks-docx",
          label: "Export tasks as DOCX",
          icon: FileText,
          group: "Tasks",
          keywords: ["docx", "download"],
          run: () => exportTasks("docx"),
        },
        {
          id: "new-file",
          label: "New file",
          hint: "⌘N",
          icon: FilePlus,
          group: "Global",
          keywords: ["note", "draft", "create"],
          run: () => {
            closePalette();
            setView("write");
            void useStore
              .getState()
              .createDraft()
              .then(() => sounds.pop())
              .catch((e) => alert((e as Error).message));
          },
        },
        {
          id: "open-settings",
          label: "Open settings",
          hint: "⌘,",
          icon: SettingsIcon,
          group: "Global",
          keywords: ["preferences", "config"],
          run: () => {
            closePalette();
            openSettings();
          },
        },
        ...(tree.some((n) => n.path === "Notes/Welcome.md")
          ? [
              {
                id: "open-welcome",
                label: "Open Welcome note",
                icon: BookOpen,
                group: "Global",
                keywords: ["help", "getting started", "onboarding", "tour", "guide"],
                run: () => void openFile("Notes/Welcome.md"),
              },
            ]
          : []),
        {
          id: "toggle-sidebar",
          label: "Toggle sidebar",
          hint: "⌘⇧B",
          icon: PanelLeft,
          group: "Global",
          keywords: ["panel", "files", "tree"],
          run: () => {
            closePalette();
            toggleSidebar();
          },
        },
        {
          id: "toggle-sounds",
          label: soundsOn ? "Turn sound effects off" : "Turn sound effects on",
          icon: soundsOn ? Volume2 : VolumeX,
          group: "Global",
          keywords: ["sounds", "sfx", "audio", "mute"],
          run: () => {
            closePalette();
            const next = !soundsEnabled();
            setSoundsEnabled(next);
            if (next) sounds.tick();
          },
        },
        {
          id: "reindex",
          label: "Reindex search",
          icon: RefreshCw,
          group: "Global",
          keywords: ["index", "embeddings", "semantic", "rebuild"],
          run: () => {
            closePalette();
            void api
              .reindex()
              .then(() => sounds.tick())
              .catch((e) => alert((e as Error).message));
          },
        },
        {
          id: "switch-workspace",
          label: "Switch workspace…",
          icon: FolderOpen,
          group: "Global",
          keywords: ["folder", "change", "location"],
          run: () => void switchWorkspace(),
        },
        {
          id: "set-theme",
          label: "Set theme…",
          hint: "light · dark · system",
          icon: Palette,
          group: "Global",
          keywords: ["dark", "light", "appearance"],
          run: () => setQuery("set theme "),
        },
      );
      return list;
  }

  const paramItems = paramCandidates(query, paramActions);

  const grouped = (() => {
    const map = new Map<string, ActionItem[]>();
    for (const a of actions) {
      const key = a.group ?? "";
      const bucket = map.get(key) ?? [];
      bucket.push(a);
      map.set(key, bucket);
    }
    return map;
  })();

  const filteredActions = q
    ? actions
        .map((a) => ({ action: a, score: actionScore(a.label, a.keywords, q) }))
        .filter(
          (x) =>
            x.score > 0 &&
            !(x.action.id === "set-theme" && paramItems.length > 0),
        )
        .sort((a, b) => b.score - a.score)
        .map((x) => x.action)
    : [];

  const showFiles = !journal && (mode === "search" || query.length >= 2);
  const searchEmpty = mode === "search" && !query.trim();
  const hasNewFile = paramItems.some((i) => i.id === "new-file:text" && !i.disabled);

  const showCreateTask = Boolean(query.trim() && parsedTask && parsedTask.title && !hasNewFile);

  // The "Create task" action must be the FIRST selectable item in commands
  // mode, otherwise cmdk's default selection lands on a file/"Best matches"
  // hit and Enter creates nothing.
  const createTaskItem = showCreateTask ? (
    <Command.Item
      value={`create-task:${query}`}
      onSelect={() => void createTask()}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
    >
      <Zap className="w-3.5 h-3.5 text-blue-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-stone-700 dark:text-stone-300">
          Create task: <span className="font-medium">{parsedTask!.title}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
          {parsedTask!.project && (
            <span className="flex items-center gap-0.5 text-blue-600">
              <Tag className="w-2.5 h-2.5" /> #{parsedTask!.project}
            </span>
          )}
          {parsedTask!.due && (
            <span className="flex items-center gap-0.5">
              <Calendar className="w-2.5 h-2.5" /> {parsedTask!.due}
            </span>
          )}
          {parsedTask!.priority !== "medium" && (
            <span className="flex items-center gap-0.5">
              <Flag className="w-2.5 h-2.5" /> {parsedTask!.priority}
            </span>
          )}
        </div>
      </div>
    </Command.Item>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div
        className="absolute inset-0 bg-stone-900/10 dark:bg-black/40 backdrop-blur-[1px]"
        onClick={closePalette}
      />
      <Command
        className="aura-border pop-in relative w-[560px] max-w-[90vw] rounded-xl shadow-2xl shadow-stone-900/15 overflow-hidden"
        shouldFilter={false}
        onKeyDown={(e) => {
          if (e.key === "Escape") closePalette();
          else if (e.key === "Tab") {
            const completion = completePrefix(query, paramActions);
            if (completion) {
              e.preventDefault();
              setQuery(completion);
            }
          }
        }}
      >
        <div className="flex items-center border-b border-stone-100 dark:border-stone-700/60 px-3.5">
          <Search className="w-4 h-4 text-stone-400 dark:text-stone-500 shrink-0" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              mode === "search"
                ? "Search Persona…"
                : "Type a command or search…"
            }
            className="flex-1 px-3 py-3 text-[14px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 dark:text-stone-200 bg-transparent"
          />
          {paletteScope && (
            <button
              onClick={() => openPalette(mode)}
              title="Clear scope"
              className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 rounded-full pl-2 pr-1 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-950/70 transition-colors shrink-0"
            >
              <FolderOpen className="w-3 h-3" />
              <span className="max-w-[140px] truncate">in: {paletteScope}</span>
              <X className="w-3 h-3" />
            </button>
          )}
          <kbd className="text-[10px] text-stone-400 dark:text-stone-500 border border-stone-200 dark:border-stone-700 rounded px-1.5 py-0.5 ml-1.5">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
          {searchEmpty && pins.files.length > 0 && (
            <Command.Group heading="Pinned notes">
              {pins.files.map((file) => (
                <Command.Item
                  key={`pin:${file.path}`}
                  value={`pin:${file.path}`}
                  onSelect={() => void openFile(file.path)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="flex-1 truncate text-[13px] text-stone-700 dark:text-stone-300">
                    {file.name}
                  </span>
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate max-w-[200px]">
                    {file.path}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {searchEmpty && pins.tasks.length > 0 && (
            <Command.Group heading="Pinned tasks">
              {pins.tasks.map((task) => (
                <Command.Item
                  key={`pintask:${task.id}`}
                  value={`pintask:${task.id}`}
                  onSelect={() => {
                    closePalette();
                    setView("tasks");
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="flex-1 truncate text-[13px] text-stone-700 dark:text-stone-300">
                    {task.title}
                  </span>
                  {task.project && (
                    <span className="text-[11px] text-blue-600">#{task.project}</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {mode === "commands" && createTaskItem && (
            <Command.Group heading="Create">
              {createTaskItem}
            </Command.Group>
          )}

          {query.trim() && showFiles && (
            <Command.Group heading="Files">
              {results.files.map((file) => (
                <Command.Item
                  key={file.path}
                  value={`file:${file.path}`}
                  onSelect={() => void openFile(file.path)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <File className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                  <span className="flex-1 truncate text-[13px] text-stone-700 dark:text-stone-300">
                    {file.name}
                  </span>
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate max-w-[200px]">
                    {file.path}
                  </span>
                </Command.Item>
              ))}
              {results.files.length === 0 && query.trim() && (
                <div className="px-2.5 py-1.5 text-[12px] text-stone-400 dark:text-stone-500">
                  No file matches
                </div>
              )}
            </Command.Group>
          )}

          {query.trim() && showFiles && results.semantic.length > 0 && (
            <Command.Group heading="Best matches">
              {results.semantic.map((hit) => (
                <Command.Item
                  key={`semantic:${hit.path}`}
                  value={`semantic:${hit.path}`}
                  onSelect={() => void openFile(hit.path)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] text-stone-700 dark:text-stone-300">
                        {hit.name}
                      </span>
                      <span className="text-[10.5px] text-blue-500 shrink-0">
                        {(hit.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="truncate text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                      {hit.snippet}
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {query.trim() && !journal && (
            <Command.Group heading="Tasks">
              {results.tasks.map((task) => (
                <Command.Item
                  key={task.id}
                  value={`task:${task.id}`}
                  onSelect={() => {
                    closePalette();
                    setView("tasks");
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <SquareCheck
                    className={`w-3.5 h-3.5 shrink-0 ${
                      task.status === "done" ? "text-emerald-500" : "text-stone-300 dark:text-stone-600"
                    }`}
                  />
                  <span className="flex-1 truncate text-[13px] text-stone-700 dark:text-stone-300">
                    {task.title}
                  </span>
                  {task.project && (
                    <span className="text-[11px] text-blue-600">#{task.project}</span>
                  )}
                  <button
                    aria-label={task.status === "done" ? "Mark as to do" : "Mark as done"}
                    title={task.status === "done" ? "Mark as to do" : "Mark as done"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleTask(task);
                    }}
                    className="p-1 rounded-md text-stone-300 dark:text-stone-600 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors shrink-0"
                  >
                    {task.status === "done" ? (
                      <RotateCcw className="w-3 h-3" />
                    ) : (
                      <Circle className="w-3 h-3" strokeWidth={2} />
                    )}
                  </button>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {query.trim() && !journal && mode === "search" && chatHits.length > 0 && (
            <Command.Group heading="Chats">
              {chatHits.map((hit) => (
                <Command.Item
                  key={`chat:${hit.id}`}
                  value={`chat:${hit.id}`}
                  onSelect={() => {
                    closePalette();
                    void loadChat(hit.id);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[13px] text-stone-700 dark:text-stone-300">
                      {hit.title}
                    </div>
                    <div className="truncate text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                      {hit.snippet}
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {q ? (
            <Command.Group heading="Actions">
              {paramItems.map((action) => (
                <Command.Item
                  key={action.id}
                  value={`param:${action.id}`}
                  disabled={action.disabled}
                  onSelect={action.run}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900 data-[disabled=true]:cursor-default data-[disabled=true]:opacity-60"
                >
                  <action.icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                  <span className="flex-1 truncate text-[13px] text-stone-700 dark:text-stone-300">
                    {action.label}
                  </span>
                  {action.hint && (
                    <span className="text-[11px] text-stone-400 dark:text-stone-500 shrink-0">
                      {action.hint}
                    </span>
                  )}
                </Command.Item>
              ))}

              {filteredActions.map((action) => (
                <Command.Item
                  key={`action:${action.id}`}
                  value={`action:${action.id}`}
                  onSelect={action.run}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                >
                  <action.icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                  <span
                    className={`flex-1 truncate text-[13px] ${
                      action.danger
                        ? "text-red-600 dark:text-red-400"
                        : "text-stone-700 dark:text-stone-300"
                    }`}
                  >
                    {action.label}
                  </span>
                  {action.hint && (
                    <span className="text-[11px] text-stone-400 dark:text-stone-500 shrink-0">
                      {action.hint}
                    </span>
                  )}
                </Command.Item>
              ))}

              {mode === "search" && createTaskItem && (
                <>
                  <Command.Separator className="h-px bg-stone-100 dark:bg-stone-700/40 my-1" />
                  {createTaskItem}
                </>
              )}
            </Command.Group>
          ) : mode === "commands" ? (
            <>
              {GROUP_ORDER.map((group) => {
                const items = grouped.get(group);
                if (!items || items.length === 0) return null;
                return (
                  <Command.Group key={group} heading={group}>
                    {items.map((action) => (
                      <Command.Item
                        key={`action:${action.id}`}
                        value={`action:${action.id}`}
                        onSelect={action.run}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900"
                      >
                        <action.icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                        <span
                          className={`flex-1 truncate text-[13px] ${
                            action.danger
                              ? "text-red-600 dark:text-red-400"
                              : "text-stone-700 dark:text-stone-300"
                          }`}
                        >
                          {action.label}
                        </span>
                        {action.hint && (
                          <span className="text-[11px] text-stone-400 dark:text-stone-500 shrink-0">
                            {action.hint}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
            </>
          ) : null}

          {searchEmpty && pins.files.length === 0 && pins.tasks.length === 0 && (
            <div className="px-2.5 py-1.5 text-[12px] text-stone-400 dark:text-stone-500">
              Start typing to search notes, tasks, or pinned items. Press ⌘K for commands.
            </div>
          )}
        </Command.List>

        <div className="flex items-center justify-between px-3.5 py-2 border-t border-stone-100 dark:border-stone-700/60 text-[10.5px] text-stone-400 dark:text-stone-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">↑↓</kbd>
              move
            </span>
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">tab</kbd>
              complete
            </span>
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">esc</kbd>
              close
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">⌘K</kbd>
              commands
            </span>
            <span className="flex items-center gap-1">
              <kbd className="border border-stone-200 dark:border-stone-700 rounded px-1 py-px">⌘P</kbd>
              search
            </span>
          </div>
        </div>
      </Command>
    </div>
  );
}
