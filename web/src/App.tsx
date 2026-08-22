import { useEffect, useRef, useState } from "react";
import { useStore } from "./state/store";
import { DEFAULT_ACCENT, applyAccent } from "./lib/accent";
import { applyTypography } from "./lib/typography";
import { api } from "./lib/api";
import type { LockSettings } from "../../src/shared/types";
import Sidebar from "./components/Sidebar";
import WriteView from "./components/WriteView";
import TasksView from "./components/TasksView";
import ChatView from "./components/ChatView";
import TodayView from "./components/TodayView";
import CommandPalette from "./components/CommandPalette";
import SettingsModal from "./components/SettingsModal";
import FocusModal from "./components/FocusModal";
import FocusTimer from "./components/FocusTimer";
import WelcomeScreen from "./components/WelcomeScreen";
import StatusBar from "./components/StatusBar";
import ConfettiBurst from "./components/Confetti";
import LockOverlay from "./components/LockOverlay";

export default function App() {
  const booted = useStore((s) => s.booted);
  const configured = useStore((s) => s.configured);
  const onboarding = useStore((s) => s.onboarding);
  const view = useStore((s) => s.view);
  const boot = useStore((s) => s.boot);
  const setView = useStore((s) => s.setView);
  const openPalette = useStore((s) => s.openPalette);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const focusTaskComposer = useStore((s) => s.focusTaskComposer);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const refreshPins = useStore((s) => s.refreshPins);
  const refreshChats = useStore((s) => s.refreshChats);
  const reloadSettings = useStore((s) => s.reloadSettings);
  const openSettings = useStore((s) => s.openSettings);
  const nextTab = useStore((s) => s.nextTab);
  const prevTab = useStore((s) => s.prevTab);
  const closeDoc = useStore((s) => s.closeDoc);
  const activeDocPath = useStore((s) => s.activeDocPath);
  const createDraft = useStore((s) => s.createDraft);
  const confettiCount = useStore((s) => s.confettiCount);

  const [lock, setLock] = useState<LockSettings | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  useEffect(() => {
    void boot();
  }, [boot]);

  const theme = useStore((s) => s.settings?.theme ?? "system");
  const accent = useStore((s) => s.settings?.accent ?? DEFAULT_ACCENT);
  const typography = useStore((s) => s.settings?.typography);

  useEffect(() => {
    applyTypography(typography);
  }, [typography]);

  // Keep a timer ref for the theme-change transition class.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    let firstRun = true;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      const el = document.documentElement;
      // Smoothly animate the switch between light/dark (and back). Skipped on
      // the first run so the initial paint never animates.
      if (!firstRun) el.classList.add("theme-transition");
      el.classList.toggle("dark", dark);
      applyAccent(accent);
      firstRun = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("theme-transition"), 650);
    };
    apply();
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => {
        mq.removeEventListener("change", apply);
        if (timer) clearTimeout(timer);
      };
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [theme, accent]);

  useEffect(() => {
    if (!booted) return;
    const source = new EventSource("/api/events");
    source.onmessage = (event) => {
      if (event.data === "ping") return;
      try {
        const payload = JSON.parse(event.data) as { type: string };
        if (payload.type === "fs") void refreshTree();
        else if (payload.type === "tasks") void refreshTasks();
        else if (payload.type === "chats") {
          void refreshChats();
          const chatId = useStore.getState().currentChatId;
          if (chatId) void api.getChat(chatId).then((c) => useStore.setState({ messages: c.messages })).catch(() => {});
        } else if (payload.type === "pins") void refreshPins();
        else if (payload.type === "settings") {
          void reloadSettings();
          void api.getLock().then(setLock).catch(() => {});
        }
      } catch {
        // ignore malformed
      }
    };
    return () => source.close();
  }, [booted, refreshTree, refreshTasks, refreshChats, refreshPins, reloadSettings]);

  // App lock: load preferences, lock on launch when a PIN is set, and
  // re-prompt after the configured idle window (skipped while AI streams).
  useEffect(() => {
    if (!booted) return;
    void api
      .getLock()
      .then((l) => {
        setLock(l);
        if (l.enabled && l.hasPin) setLocked(true);
      })
      .catch(() => {});
  }, [booted]);

  useEffect(() => {
    if (!lock?.enabled || !lock.hasPin) return;
    let lastActivity = Date.now();
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];
    const mark = () => {
      lastActivity = Date.now();
    };
    for (const ev of activityEvents) window.addEventListener(ev, mark, { passive: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastActivity > lock.idleMinutes * 60_000) setLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (Date.now() - lastActivity > lock.idleMinutes * 60_000) setLocked(true);
    }, 15_000);
    return () => {
      for (const ev of activityEvents) window.removeEventListener(ev, mark);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [lock]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        openPalette("commands");
      } else if (key === "p") {
        e.preventDefault();
        openPalette("search");
      } else if (key === "1") {
        e.preventDefault();
        setView("write");
      } else if (key === "2") {
        e.preventDefault();
        setView("tasks");
      } else if (key === "3") {
        e.preventDefault();
        setView("chat");
      } else if (key === "n" && e.shiftKey) {
        e.preventDefault();
        setView("tasks");
        focusTaskComposer();
      } else if (key === "n") {
        e.preventDefault();
        setView("write");
        void createDraft();
      } else if (key === ",") {
        e.preventDefault();
        openSettings();
      } else if (key === "b" && e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "w") {
        e.preventDefault();
        if (activeDocPath) closeDoc(activeDocPath);
      } else if (key === "]" && e.shiftKey) {
        e.preventDefault();
        nextTab();
      } else if (key === "[" && e.shiftKey) {
        e.preventDefault();
        prevTab();
      } else if (key === "t") {
        e.preventDefault();
        setView("write");
        void createDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette, setView, focusTaskComposer, openSettings, toggleSidebar, closeDoc, activeDocPath, nextTab, prevTab, createDraft]);

  if (!booted) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 dark:text-stone-500 text-sm">
        Persona…
      </div>
    );
  }

  if (locked) {
    return (
      <LockOverlay
        onUnlock={() => setLocked(false)}
        onLockChange={setLock}
      />
    );
  }

  if (!configured || onboarding) return <WelcomeScreen />;

  return (
    <div className="h-full flex flex-col bg-stone-50 dark:bg-stone-900">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0">
          {view === "write" && <WriteView />}
          {view === "tasks" && <TasksView />}
          {view === "chat" && <ChatView />}
          {view === "today" && <TodayView />}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <FocusModal />
      <SettingsModal />
      <FocusTimer />
      <ConfettiBurst count={confettiCount} />
    </div>
  );
}
