import { useState } from "react";
import { format } from "date-fns";
import { BookOpen, Plus } from "lucide-react";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";

export default function JournalModule() {
  const refreshTree = useStore((s) => s.refreshTree);
  const openDoc = useStore((s) => s.openDoc);
  const setView = useStore((s) => s.setView);
  const [text, setText] = useState("");

  const today = format(new Date(), "yyyy-MM-dd");
  const path = `Notes/${today}.md`;

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    try {
      await api.capture(value);
    } catch {
      // ignore — the note append is best-effort
    }
    sounds.pop();
    await refreshTree();
  };

  const openToday = async () => {
    setView("write");
    await openDoc(path);
  };

  return (
    <div className="px-2 space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <BookOpen className="w-3 h-3 text-amber-500" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Journal
        </span>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 px-2 py-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setText("");
          }}
          placeholder="Quick capture…"
          className="flex-1 min-w-0 bg-transparent text-[12px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 text-stone-700 dark:text-stone-300"
        />
        <button
          onClick={() => void submit()}
          disabled={!text.trim()}
          title="Log to journal"
          className="text-stone-400 dark:text-stone-500 hover:text-amber-600 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <button
        onClick={() => void openToday()}
        className="w-full text-left px-1 text-[11.5px] text-stone-500 dark:text-stone-400 hover:text-amber-600"
      >
        Open today&apos;s note
      </button>
    </div>
  );
}
