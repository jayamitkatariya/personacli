import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import { useStore } from "../state/store";

export default function StatusBar() {
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const docs = useStore((s) => s.docs);
  const activeDocPath = useStore((s) => s.activeDocPath);
  const doc = docs.find((d) => d.path === activeDocPath) ?? null;
  const tasks = useStore((s) => s.tasks);
  const openSettings = useStore((s) => s.openSettings);
  const chatMessages = useStore((s) => s.messages);

  const prevStatus = useRef(doc?.status);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (
      prevStatus.current &&
      prevStatus.current !== "saved" &&
      doc?.status === "saved"
    ) {
      setFlash((f) => f + 1);
    }
    prevStatus.current = doc?.status;
  }, [doc?.status]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(0), 1000);
    return () => clearTimeout(t);
  }, [flash]);

  const left = settings?.workspace ?? "";
  const home = left.replace(/^\/Users\/[^/]+/, "~");

  const needsAi = !settings?.ai.hasKey && !settings?.ai.local?.model;

  const hasActiveChat = chatMessages.some((m) => m.role === "assistant" && (m.status === "queued" || m.status === "streaming"));
  const chatTokens = chatMessages.reduce(
    (acc, m) => {
      if (m.usage) {
        acc.prompt += m.usage.promptTokens;
        acc.completion += m.usage.completionTokens;
      }
      return acc;
    },
    { prompt: 0, completion: 0 },
  );
  const showChatTokens = view === "chat" && !hasActiveChat && (chatTokens.prompt > 0 || chatTokens.completion > 0);
  const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  let right = "";
  if (view === "write" && doc) {
    right =
      doc.status === "saved"
        ? "Saved"
        : doc.status === "saving"
          ? "Saving…"
          : doc.status === "conflict"
            ? "Changed on disk — reload"
            : "Unsaved";
  } else if (view === "chat") {
    right = hasActiveChat
      ? "Thinking…"
      : settings?.ai.model
        ? `${settings?.ai.provider} · ${settings?.ai.model}`
        : settings?.ai.provider ?? "";
    if (showChatTokens) {
      right += ` · ${formatTokens(chatTokens.prompt)} in / ${formatTokens(chatTokens.completion)} out`;
    }
  } else if (view === "tasks") {
    right = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  } else if (view === "today") {
    const today = format(new Date(), "yyyy-MM-dd");
    const open = tasks.filter((t) => t.status === "todo" && t.due && t.due <= today).length;
    right = `${open} today`;
  }

  return (
    <footer className="h-6 shrink-0 border-t border-stone-200/80 bg-white dark:bg-stone-800 dark:border-stone-800 flex items-center justify-between px-3 text-[10.5px] text-stone-400 dark:text-stone-500">
      <span className="truncate" title={left}>
        {home || "Persona"}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {needsAi && (
          <button
            onClick={openSettings}
            className="flex items-center gap-1 px-1.5 py-px rounded text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
            title="Chat and AI features need a model — set one up in Settings"
          >
            <Sparkles className="w-2.5 h-2.5" />
            <span>AI not set up — ⌘,</span>
          </button>
        )}
        <span
          key={flash}
          title={
            showChatTokens
              ? `${chatTokens.prompt.toLocaleString("en-US")} prompt · ${chatTokens.completion.toLocaleString("en-US")} completion tokens`
              : undefined
          }
          className={
            doc?.status === "conflict"
              ? "text-amber-600 font-medium"
              : flash
                ? "saved-flash"
                : undefined
          }
        >
          {right}
        </span>
      </div>
    </footer>
  );
}
