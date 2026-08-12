import { create } from "zustand";
import type {
  ChatMessage,
  ChatMeta,
  ChatSource,
  FileKind,
  Pinboard,
  Settings,
  Task,
  TreeNode,
} from "../../../src/shared/types";
import { fileKind } from "../../../src/shared/types";
import { api } from "../lib/api";

export type View = "write" | "tasks" | "chat" | "today";
export type SaveStatus = "saved" | "saving" | "unsaved" | "conflict";
export type SidebarTab = "code" | "edit" | "profile";

export interface OpenDoc {
  path: string;
  kind: FileKind;
  content: string;
  savedContent: string;
  status: SaveStatus;
}

/** One-shot request to open a doc and scroll to a line (chat citations). */
export interface LineJump {
  path: string;
  line: number;
  id: number;
}

/** A running focus session: a countdown timer bound to selected tasks. */
export interface FocusSession {
  minutes: number;
  durationSec: number;
  taskIds: string[];
  remaining: number;
  running: boolean;
  lastTick: number;
}

interface Store {
  booted: boolean;
  configured: boolean;
  /** True while the first-run setup wizard is active (keeps it mounted even
   *  after the workspace is saved and `configured` flips). */
  onboarding: boolean;
  settings: Settings | null;
  view: View;
  tree: TreeNode[];
  tasks: Task[];
  pins: Pinboard;
  docs: OpenDoc[];
  activeDocPath: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  chats: ChatMeta[];
  currentChatId: string | null;
  expanded: Record<string, boolean>;
  paletteOpen: boolean;
  paletteMode: "search" | "commands";
  /** Restrict search results to this folder when the palette opens. */
  paletteScope: string | null;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  taskComposerFocus: number;
  treeFilter: string | null;
  sidebarTab: SidebarTab;
  taskProjectFilter: string | null;
  docTags: Record<string, string[]>;
  tagBusy: boolean;
  pendingLineJump: LineJump | null;
  confettiCount: number;
  focusOpen: boolean;
  focusSession: FocusSession | null;

  boot: () => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshPins: () => Promise<void>;
  refreshChats: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  createDraft: () => Promise<void>;
  finishOnboarding: () => void;

  setView: (view: View) => void;
  toggleExpand: (path: string) => void;
  openDoc: (path: string) => Promise<void>;
  setActiveDoc: (path: string) => void;
  closeDoc: (path: string) => void;
  closeDocsUnder: (prefix: string) => void;
  retargetDocs: (from: string, to: string) => void;
  setDocContent: (path: string, content: string) => void;
  markDocSaving: (path: string) => void;
  markDocSaved: (path: string, savedContent: string) => void;
  markDocSaveFailed: (path: string) => void;
  applyExternalContent: (path: string, content: string) => void;
  markDocConflict: (path: string) => void;
  reloadDoc: (path: string) => Promise<void>;
  nextTab: () => void;
  prevTab: () => void;

  openPalette: (mode: "search" | "commands", scope?: string | null) => void;
  closePalette: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSidebar: () => void;
  focusTaskComposer: () => void;
  setTreeFilter: (filter: string | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setTaskProjectFilter: (filter: string | null) => void;
  suggestAndApplyTags: (path: string) => Promise<void>;
  clearDocTags: (path: string) => void;
  pinFile: (path: string) => Promise<void>;
  unpinFile: (path: string) => Promise<void>;
  pinTask: (id: string) => Promise<void>;
  unpinTask: (id: string) => Promise<void>;

  pushMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string | ((prev: string) => string)) => void;
  updateMessage: (id: string, content: string) => void;
  popLastMessage: () => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
  attachMessageSources: (sources: ChatSource[]) => void;
  loadChat: (id: string) => Promise<void>;
  startNewChat: () => void;
  setCurrentChatId: (id: string | null) => void;
  openDocAtLine: (path: string, line: number) => void;
  clearLineJump: () => void;
  triggerConfetti: () => void;

  openFocus: () => void;
  closeFocus: () => void;
  startFocus: (minutes: number, taskIds: string[]) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void;
  finishFocus: () => void;
  tickFocus: (remaining: number, lastTick: number) => void;
}

export const useStore = create<Store>((set, get) => ({
  booted: false,
  configured: false,
  onboarding: false,
  settings: null,
  view: "chat",
  tree: [],
  tasks: [],
  pins: { files: [], tasks: [], missing: [] },
  docs: [],
  activeDocPath: null,
  messages: [],
  streaming: false,
  chats: [],
  currentChatId: null,
  expanded: {},
  paletteOpen: false,
  paletteMode: "commands",
  paletteScope: null,
  settingsOpen: false,
  sidebarOpen: true,
  taskComposerFocus: 0,
  treeFilter: null,
  sidebarTab: "code",
  taskProjectFilter: null,
  docTags: {},
  tagBusy: false,
  pendingLineJump: null,
  confettiCount: 0,
  focusOpen: false,
  focusSession: null,

  boot: async () => {
    const settings = await api.getSettings().catch(() => null);
    set({
      settings,
      configured: Boolean(settings?.configured),
      onboarding: !Boolean(settings?.configured),
      booted: true,
    });
    if (settings?.configured) {
      get().refreshTree();
      get().refreshTasks();
      get().refreshPins();
      get().refreshChats();
    }
  },

  finishOnboarding: () => set({ onboarding: false, configured: true }),

  refreshTree: async () => {
    const tree = await api.tree().catch(() => []);
    set({ tree });
  },

  refreshTasks: async () => {
    const tasks = await api.tasks().catch(() => []);
    set({ tasks });
  },

  createDraft: async () => {
    const name = `untitled-${Date.now()}.md`;
    const res = await api.createEntry(name, "file");
    await get().refreshTree();
    await get().openDoc(res.path);
  },

  refreshPins: async () => {
    const pins = await api.pins().catch(() => ({ files: [], tasks: [], missing: [] }));
    set({ pins });
  },

  refreshChats: async () => {
    const chats = await api.chats().catch(() => []);
    set({ chats });
  },

  reloadSettings: async () => {
    const prevWorkspace = get().settings?.workspace ?? null;
    const settings = await api.getSettings().catch(() => null);
    const nextWorkspace = settings?.workspace ?? null;
    set({
      settings,
      configured: Boolean(settings?.configured),
      tree: settings?.configured ? get().tree : [],
      // A different workspace means every open tab points at another
      // workspace's files — close them all rather than editing the wrong tree.
      docs: prevWorkspace && nextWorkspace && prevWorkspace !== nextWorkspace ? [] : get().docs,
      activeDocPath:
        prevWorkspace && nextWorkspace && prevWorkspace !== nextWorkspace ? null : get().activeDocPath,
      pendingLineJump: null,
    });
    if (settings?.configured) {
      get().refreshTree();
      get().refreshTasks();
      get().refreshPins();
      get().refreshChats();
    }
  },

  setView: (view) => {
    const tabMap = { chat: "code", write: "edit", tasks: "profile", today: "code" } as const;
    set({ view, sidebarTab: tabMap[view] });
  },

  toggleExpand: (path) =>
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),

  openDoc: async (path) => {
    const existing = get().docs.find((d) => d.path === path);
    if (existing) {
      set({ activeDocPath: path });
      return;
    }
    const kind = fileKind(path);
    if (kind === "text") {
      // Unreadable files (deleted, oversized, binary mislabeled) open in a
      // conflict state: the editor never autosaves over them.
      const read = await api.readFile(path).catch(() => null);
      const content = read ? read.content : "";
      const doc: OpenDoc = { path, kind, content, savedContent: content, status: read ? "saved" : "conflict" };
      set({ docs: [...get().docs, doc], activeDocPath: path });
      return;
    }
    // Non-text files (pdf/html/image) are served raw — never read as UTF-8 text.
    const doc: OpenDoc = { path, kind, content: "", savedContent: "", status: "saved" };
    set({ docs: [...get().docs, doc], activeDocPath: path });
  },

  setActiveDoc: (path) => set({ activeDocPath: path }),

  closeDoc: (path) => {
    const docs = get().docs;
    const idx = docs.findIndex((d) => d.path === path);
    if (idx === -1) return;
    const doc = docs[idx];
    if (doc && doc.kind === "text" && doc.status === "unsaved") {
      // flush pending changes so ⌘W never loses work
      void api.saveFile(doc.path, doc.content).catch(() => {});
    }
    const next = docs.filter((d) => d.path !== path);
    let active = get().activeDocPath;
    if (active === path) {
      active = next.length === 0 ? null : (next[Math.min(idx, next.length - 1)]?.path ?? null);
    }
    set({ docs: next, activeDocPath: active });
  },

  closeDocsUnder: (prefix) => {
    const docs = get().docs;
    const next = docs.filter((d) => !(d.path === prefix || d.path.startsWith(prefix + "/")));
    let active = get().activeDocPath;
    if (active && (active === prefix || active.startsWith(prefix + "/"))) {
      active = next.length === 0 ? null : (next[0]?.path ?? null);
    }
    set({ docs: next, activeDocPath: active });
  },

  retargetDocs: (from, to) => {
    if (!from || from === to) return;
    const { docs, activeDocPath } = get();
    let nextActive = activeDocPath;
    const nextDocs = docs.map((d) => {
      let path = d.path;
      if (path === from) path = to;
      else if (path.startsWith(from + "/")) path = to + path.slice(from.length);
      else return d;
      return { ...d, path };
    });
    if (activeDocPath === from) nextActive = to;
    else if (activeDocPath && activeDocPath.startsWith(from + "/")) {
      nextActive = to + activeDocPath.slice(from.length);
    }
    set({ docs: nextDocs, activeDocPath: nextActive });
  },

  setDocContent: (path, content) =>
    set((s) => {
      const doc = s.docs.find((d) => d.path === path);
      if (!doc || doc.content === content) return {};
      const docTags = { ...s.docTags };
      delete docTags[path];
      const status: SaveStatus =
        content === doc.savedContent
          ? "saved"
          : doc.status === "conflict"
            ? "conflict"
            : "unsaved";
      return {
        docs: s.docs.map((d) => (d.path === path ? { ...d, content, status } : d)),
        docTags,
      };
    }),

  markDocSaving: (path) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.path === path ? { ...d, status: "saving" } : d)),
    })),

  markDocSaved: (path, savedContent) =>
    set((s) => ({
      docs: s.docs.map((d) =>
        // Only mark saved if the editor hasn't changed since the save was
        // issued — otherwise a stale response would hide newer edits.
        d.path === path && d.content === savedContent
          ? { ...d, savedContent, status: "saved" }
          : d,
      ),
    })),

  markDocSaveFailed: (path) =>
    set((s) => ({
      docs: s.docs.map((d) =>
        d.path === path && d.status === "saving" ? { ...d, status: "unsaved" } : d,
      ),
    })),

  applyExternalContent: (path, content) =>
    set((s) => ({
      docs: s.docs.map((d) =>
        d.path === path ? { ...d, content, savedContent: content, status: "saved" } : d,
      ),
    })),

  markDocConflict: (path) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.path === path ? { ...d, status: "conflict" } : d)),
    })),

  reloadDoc: async (path) => {
    const current = get().docs.find((d) => d.path === path);
    if (!current) return;
    if (current.kind !== "text") {
      set((s) => ({
        docs: s.docs.map((d) =>
          d.path === path ? { ...d, status: "saved" } : d,
        ),
      }));
      return;
    }
    const { content } = await api.readFile(path).catch(() => ({ content: "" }));
    set((s) => ({
      docs: s.docs.map((d) =>
        d.path === path ? { ...d, content, savedContent: content, status: "saved" } : d,
      ),
    }));
  },

  nextTab: () => {
    const { docs, activeDocPath } = get();
    if (docs.length < 2) return;
    const idx = docs.findIndex((d) => d.path === activeDocPath);
    const next = docs[(idx + 1) % docs.length];
    if (next) set({ activeDocPath: next.path });
  },

  prevTab: () => {
    const { docs, activeDocPath } = get();
    if (docs.length < 2) return;
    const idx = docs.findIndex((d) => d.path === activeDocPath);
    const prev = docs[(idx - 1 + docs.length) % docs.length];
    if (prev) set({ activeDocPath: prev.path });
  },

  openPalette: (mode, scope) =>
    set({ paletteOpen: true, paletteMode: mode, paletteScope: scope ?? null }),
  closePalette: () => set({ paletteOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  focusTaskComposer: () => set((s) => ({ taskComposerFocus: s.taskComposerFocus + 1 })),
  setTreeFilter: (filter) => set({ treeFilter: filter }),
  setTaskProjectFilter: (filter) => set({ taskProjectFilter: filter }),
  setSidebarTab: (tab) => {
    const viewMap = { code: "chat", edit: "write", profile: "tasks" } as const;
    set({ sidebarTab: tab, view: viewMap[tab] });
  },

  suggestAndApplyTags: async (path) => {
    const state = get();
    if (state.tagBusy) return;
    const doc = state.docs.find((d) => d.path === path);
    if (!doc || doc.kind !== "text") return;
    set({ tagBusy: true });
    try {
      const content = doc.content;
      if (doc.status !== "saved") {
        try {
          await api.saveFile(path, content);
          set((s) => ({
            docs: s.docs.map((d) =>
              d.path === path && d.content === content
                ? { ...d, savedContent: content, status: "saved" }
                : d,
            ),
          }));
        } catch {
          return;
        }
      }
      const res = await api.suggestTags(path, content);
      if (res.tags.length === 0) return;
      const fresh = get().docs.find((d) => d.path === path);
      if (!fresh) return;
      // The server already wrote the merged note to disk. If the editor is
      // still on the pre-request content, apply the merged version directly;
      // otherwise the live filesystem sync has already brought it in — either
      // way, surface the suggested tags.
      if (fresh.content === content) {
        get().applyExternalContent(path, res.content);
      }
      set((s) => ({ docTags: { ...s.docTags, [path]: res.tags } }));
    } catch {
      // AI not available — tags stay unsuggested, no user-facing error
    } finally {
      set({ tagBusy: false });
    }
  },

  clearDocTags: (path) =>
    set((s) => {
      const docTags = { ...s.docTags };
      delete docTags[path];
      return { docTags };
    }),
  pinFile: async (path) => {
    await api.pinFile(path).catch(() => {});
    await get().refreshPins();
  },
  unpinFile: async (path) => {
    await api.unpinFile(path).catch(() => {});
    await get().refreshPins();
  },
  pinTask: async (id) => {
    await api.pinTask(id).catch(() => {});
    await get().refreshPins();
  },
  unpinTask: async (id) => {
    await api.unpinTask(id).catch(() => {});
    await get().refreshPins();
  },

  pushMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateLastMessage: (content) =>
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (last) {
        const next =
          typeof content === "function" ? content(last.content) : content;
        messages[messages.length - 1] = { ...last, content: next };
      }
      return { messages };
    }),
  updateMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),
  popLastMessage: () =>
    set((s) => ({ messages: s.messages.slice(0, -1) })),
  setStreaming: (streaming) => set({ streaming }),
  clearMessages: () => set({ messages: [] }),
  loadChat: async (id) => {
    const chat = await api.getChat(id).catch(() => null);
    if (!chat) return;
    set({
      messages: chat.messages,
      currentChatId: chat.id,
      streaming: false,
      view: "chat",
      sidebarTab: "code",
    });
  },
  startNewChat: () =>
    set({ messages: [], currentChatId: null, streaming: false, view: "chat", sidebarTab: "code" }),
  setCurrentChatId: (id) => set({ currentChatId: id }),
  attachMessageSources: (sources) =>
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") return {};
      messages[messages.length - 1] = { ...last, sources };
      return { messages };
    }),
  openDocAtLine: (path, line) => {
    set({ pendingLineJump: { path, line, id: Date.now() } });
    get().setView("write");
    void get().openDoc(path);
  },
  clearLineJump: () => set({ pendingLineJump: null }),
  triggerConfetti: () => set((s) => ({ confettiCount: s.confettiCount + 1 })),

  openFocus: () => set({ focusOpen: true }),
  closeFocus: () => set({ focusOpen: false }),
  startFocus: (minutes, taskIds) =>
    set({
      focusOpen: false,
      focusSession: {
        minutes,
        durationSec: minutes * 60,
        taskIds,
        remaining: minutes * 60,
        running: true,
        lastTick: Date.now(),
      },
    }),
  pauseFocus: () =>
    set((s) =>
      s.focusSession ? { focusSession: { ...s.focusSession, running: false } } : {},
    ),
  resumeFocus: () =>
    set((s) =>
      s.focusSession
        ? { focusSession: { ...s.focusSession, running: true, lastTick: Date.now() } }
        : {},
    ),
  stopFocus: () => set({ focusSession: null }),
  finishFocus: () =>
    set((s) =>
      s.focusSession
        ? { focusSession: { ...s.focusSession, remaining: 0, running: false } }
        : {},
    ),
  tickFocus: (remaining, lastTick) =>
    set((s) =>
      s.focusSession
        ? { focusSession: { ...s.focusSession, remaining, lastTick } }
        : {},
    ),
}));
