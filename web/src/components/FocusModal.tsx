import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Timer, X, SquareCheck, Circle, Search } from "lucide-react";
import { useStore } from "../state/store";
import { sounds } from "../lib/sounds";
import type { Task } from "../../../src/shared/types";

const DURATIONS = [15, 25, 45, 60, 90];

export default function FocusModal() {
  const open = useStore((s) => s.focusOpen);
  const closeFocus = useStore((s) => s.closeFocus);
  const startFocus = useStore((s) => s.startFocus);
  const tasks = useStore((s) => s.tasks);

  const [minutes, setMinutes] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (open) {
      setMinutes(25);
      setSelected(new Set());
      setFilter("");
    }
  }, [open]);

  const ordered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = tasks.filter((t) => t.status !== "done");
    return f ? list.filter((t) => t.title.toLowerCase().includes(f)) : list;
  }, [tasks, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canStart = selected.size > 0 && minutes > 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeFocus()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-900/10 dark:bg-black/40 backdrop-blur-[1px] z-50" />
        <Dialog.Content className="pop-in fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[430px] max-w-[92vw] max-h-[85vh] flex flex-col bg-white dark:bg-stone-800 rounded-xl shadow-2xl shadow-stone-900/15 border border-stone-200 dark:border-stone-700 z-50">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                <Timer className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <Dialog.Title className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                  Focus session
                </Dialog.Title>
                <Dialog.Description className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                  Pick a duration and the tasks you'll work on.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close focus session"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            <div className="mb-5">
              <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-400 mb-2">
                Duration
              </label>
              <div className="grid grid-cols-5 gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setMinutes(d)}
                    className={`h-9 rounded-lg border text-[13px] transition-colors ${
                      minutes === d
                        ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium"
                        : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                    }`}
                  >
                    {d}m
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mb-2">
              <label className="block text-[12px] font-medium text-stone-600 dark:text-stone-400">
                Tasks
              </label>
              <span
                className={`text-[11.5px] ${
                  selected.size > 0
                    ? "text-blue-600 dark:text-blue-400 font-medium"
                    : "text-stone-400 dark:text-stone-500"
                }`}
              >
                {selected.size > 0 ? `${selected.size} selected` : "none selected"}
              </span>
            </div>

            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tasks…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 text-[12.5px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 transition-shadow"
              />
            </div>

            <div className="max-h-[220px] overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700/80 divide-y divide-stone-100 dark:divide-stone-700/40 bg-white dark:bg-stone-700/20">
              {ordered.map((task) => (
                <TaskRow key={task.id} task={task} checked={selected.has(task.id)} onToggle={() => toggle(task.id)} />
              ))}
              {ordered.length === 0 && (
                <div className="px-3 py-4 text-center text-[12px] text-stone-400 dark:text-stone-500">
                  No tasks to focus on
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-stone-100 dark:border-stone-800">
            <span className="text-[11.5px] text-stone-400 dark:text-stone-500">
              {canStart ? "Timer starts right away" : "Select at least one task"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={closeFocus}
                className="px-3.5 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-[12.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!canStart}
                onClick={() => {
                  sounds.pop();
                  startFocus(minutes, [...selected]);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Timer className="w-3.5 h-3.5" />
                Start {minutes}m
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TaskRow({
  task,
  checked,
  onToggle,
}: {
  task: Task;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        checked
          ? "bg-blue-50/70 dark:bg-blue-950/30"
          : "hover:bg-stone-50 dark:hover:bg-stone-700/30"
      }`}
    >
      <span className="shrink-0">
        {checked ? (
          <SquareCheck className="w-4 h-4 text-blue-600" />
        ) : (
          <Circle className="w-4 h-4 text-stone-300 dark:text-stone-600" strokeWidth={1.8} />
        )}
      </span>
      <span
        className={`flex-1 truncate text-[13px] ${
          task.status === "done"
            ? "text-stone-400 dark:text-stone-500 line-through"
            : "text-stone-700 dark:text-stone-300"
        }`}
      >
        {task.title}
      </span>
      {task.project && <span className="text-[11px] text-blue-600 shrink-0">#{task.project}</span>}
    </button>
  );
}
