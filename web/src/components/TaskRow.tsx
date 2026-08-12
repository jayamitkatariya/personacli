import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, isToday, isTomorrow, isPast, parseISO } from "date-fns";
import type { Task, TaskPriority, TaskRecur, TaskStatus } from "../../../src/shared/types";
import {
  SquareCheck,
  Circle,
  Calendar,
  Repeat2,
  Flag,
  Ellipsis,
  Pin,
  PinOff,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-stone-300 dark:text-stone-600",
};

export const RECUR_OPTIONS: { value: TaskRecur; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function recurLabel(recur: TaskRecur | null): string {
  if (!recur) return "";
  if (recur === "daily") return "Daily";
  if (recur === "weekly") return "Weekly";
  if (recur === "monthly") return "Monthly";
  const n = parseInt(recur, 10);
  const unit = recur.slice(-1);
  const noun =
    unit === "d"
      ? n === 1
        ? "day"
        : "days"
      : unit === "w"
        ? n === 1
          ? "week"
          : "weeks"
        : n === 1
          ? "month"
          : "months";
  return `Every ${n} ${noun}`;
}

export function dueLabel(due: string): string {
  const date = parseISO(due);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

/**
 * Watches task status transitions and celebrates (chime + confetti) when a
 * todo task flips to done. Safe to mount in multiple views — each watcher
 * tracks its own previous snapshot.
 */
export function useTaskCelebration(tasks: Task[]) {
  const triggerConfetti = useStore((s) => s.triggerConfetti);
  const prevStatuses = useRef(new Map<string, TaskStatus>());
  useEffect(() => {
    const map = prevStatuses.current;
    for (const t of tasks) {
      if (map.get(t.id) === "todo" && t.status === "done") {
        sounds.chime();
        triggerConfetti();
      }
      map.set(t.id, t.status);
    }
    for (const id of map.keys()) {
      if (!tasks.some((t) => t.id === id)) map.delete(id);
    }
  }, [tasks, triggerConfetti]);
}

export function Section({
  title,
  count,
  children,
  icon,
}: {
  title: string;
  count: number;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="flex items-center gap-2 mb-2 px-1">
        {icon}
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-stone-500 dark:text-stone-400">{title}</h2>
        <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">{count}</span>
      </div>
      <div className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700/80 rounded-xl divide-y divide-stone-100 dark:divide-stone-700/40 overflow-hidden shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        {children}
      </div>
    </section>
  );
}

export function TaskRow({ task, onToggle, onChanged }: { task: Task; onToggle: () => void; onChanged: () => void }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const pinnedTasks = useStore((s) => s.pins.tasks);
  const pinTask = useStore((s) => s.pinTask);
  const unpinTask = useStore((s) => s.unpinTask);
  const isPinned = useMemo(() => pinnedTasks.some((t) => t.id === task.id), [pinnedTasks, task.id]);

  const overdue = task.due && task.status === "todo" && isPast(parseISO(task.due)) && !isToday(parseISO(task.due));

  return (
    <div className={`group flex items-center gap-3 px-3.5 py-2.5 row-in hover:bg-stone-50 dark:bg-stone-700/40 dark:hover:bg-stone-700/60`}>
      <button onClick={onToggle} className="shrink-0 text-stone-300 dark:text-stone-600 hover:text-blue-600 transition-colors">
        {task.status === "done" ? (
          <SquareCheck className="w-4 h-4 text-emerald-500" />
        ) : (
          <Circle className="w-4 h-4" strokeWidth={1.8} />
        )}
      </button>

      <div className="flex-1 min-w-0">
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (titleDraft.trim() && titleDraft !== task.title) {
                void api.updateTask(task.id, { title: titleDraft.trim() }).then(onChanged);
              }
              setEditingTitle(false);
            }}
          >
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => e.key === "Escape" && setEditingTitle(false)}
              className="w-full text-[13.5px] px-1.5 py-0.5 rounded border border-blue-400 outline-none"
            />
          </form>
        ) : (
          <button
            onClick={() => {
              setTitleDraft(task.title);
              setEditingTitle(true);
            }}
            className={`block text-left text-[13.5px] truncate max-w-full ${
              task.status === "done"
                ? "text-stone-400 dark:text-stone-500 line-through"
                : "text-stone-800 dark:text-stone-200 hover:text-stone-950"
            }`}
          >
            {task.title}
          </button>
        )}
        <div className="flex items-center gap-2.5 mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
          {task.due && (
            <span className={`flex items-center gap-1 ${overdue ? "text-red-500 font-medium" : ""}`}>
              <Calendar className="w-3 h-3" />
              {dueLabel(task.due)}
              {overdue && "· overdue"}
            </span>
          )}
          {task.project && <span className="text-blue-600">#{task.project}</span>}
          {task.recur && (
            <span className="flex items-center gap-1" title={`Repeats ${recurLabel(task.recur).toLowerCase()}`}>
              <Repeat2 className="w-3 h-3" />
              {recurLabel(task.recur)}
            </span>
          )}
        </div>
      </div>

      <Flag className={`w-3.5 h-3.5 shrink-0 ${PRIORITY_COLORS[task.priority]}`} strokeWidth={2} />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-stone-200 dark:hover:bg-stone-700/70 text-stone-500 dark:text-stone-400 shrink-0">
            <Ellipsis className="w-3.5 h-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="min-w-[170px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
          >
            <DropdownMenu.Label className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Priority
            </DropdownMenu.Label>
            {(["high", "medium", "low"] as TaskPriority[]).map((p) => (
              <DropdownMenu.Item
                key={p}
                onSelect={() => void api.updateTask(task.id, { priority: p }).then(onChanged)}
                className={`px-2.5 py-1.5 rounded-md cursor-pointer outline-none hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center gap-2 ${
                  task.priority === p ? "font-medium" : ""
                }`}
              >
                <Flag className={`w-3.5 h-3.5 ${PRIORITY_COLORS[p]}`} />
                {p}
                {task.priority === p && " ✓"}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="h-px bg-stone-100 dark:bg-stone-700/40 my-1" />
            <DropdownMenu.Label className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Due
            </DropdownMenu.Label>
            <div className="px-2.5 pb-1">
              <input
                type="date"
                value={task.due ?? ""}
                onChange={(e) =>
                  void api
                    .updateTask(task.id, { due: e.target.value || null })
                    .then(onChanged)
                }
                className="w-full text-[12.5px] px-2 py-1 rounded border border-stone-200 dark:border-stone-700 outline-none focus:border-blue-400"
              />
            </div>
            <DropdownMenu.Separator className="h-px bg-stone-100 dark:bg-stone-700/40 my-1" />
            <DropdownMenu.Label className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Repeat
            </DropdownMenu.Label>
            <DropdownMenu.Item
              onSelect={() => void api.updateTask(task.id, { recur: null }).then(onChanged)}
              className={`px-2.5 py-1.5 rounded-md cursor-pointer outline-none hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center gap-2 ${
                !task.recur ? "font-medium" : ""
              }`}
            >
              <Repeat2 className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
              None
              {!task.recur && " ✓"}
            </DropdownMenu.Item>
            {RECUR_OPTIONS.map((r) => (
              <DropdownMenu.Item
                key={r.value}
                onSelect={() => void api.updateTask(task.id, { recur: r.value }).then(onChanged)}
                className={`px-2.5 py-1.5 rounded-md cursor-pointer outline-none hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center gap-2 ${
                  task.recur === r.value ? "font-medium" : ""
                }`}
              >
                <Repeat2 className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                {r.label}
                {task.recur === r.value && " ✓"}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="h-px bg-stone-100 dark:bg-stone-700/40 my-1" />
            <DropdownMenu.Item
              onSelect={() => {
                if (isPinned) void unpinTask(task.id);
                else void pinTask(task.id);
              }}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center gap-2"
            >
              {isPinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                  Unpin from pinboard
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                  Pin to pinboard
                </>
              )}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="h-px bg-stone-100 dark:bg-stone-700/40 my-1" />
            <DropdownMenu.Item
              onSelect={() => {
                if (confirm(`Delete "${task.title}"?`)) {
                  void api.deleteTask(task.id).then(onChanged);
                }
              }}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-red-600 hover:bg-red-50 focus:bg-red-50"
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
