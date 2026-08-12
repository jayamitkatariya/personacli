import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Sunrise,
  Plus,
  Circle,
  SquareCheck,
  ListTodo,
  Calendar,
  Flag,
  Repeat2,
  Loader2,
} from "lucide-react";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";
import type { ParsedTask, Task } from "../../../src/shared/types";
import { Section, TaskRow, dueLabel, recurLabel, useTaskCelebration, PRIORITY_COLORS } from "./TaskRow";
import EmptyState from "./EmptyState";

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function TodayView() {
  const tasks = useStore((s) => s.tasks);
  const refreshTasks = useStore((s) => s.refreshTasks);

  const [text, setText] = useState("");
  const [items, setItems] = useState<ParsedTask[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useTaskCelebration(tasks);

  // Auto-grow the input bar as the paragraph grows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  // Live preview: show exactly which tasks the paragraph will become.
  useEffect(() => {
    if (!text.trim()) {
      setItems(null);
      setParsing(false);
      return;
    }
    setParsing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.parseTasksBulk(text);
        setItems(res.items);
      } catch {
        setItems(null);
      } finally {
        setParsing(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  const today = todayISO();
  const openToday = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "todo" && t.due && t.due <= today)
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    [tasks, today],
  );
  const doneToday = useMemo(
    () => tasks.filter((t) => t.status === "done" && t.updated.slice(0, 10) === today),
    [tasks, today],
  );

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    setItems(null);
    setParsing(false);
    try {
      const res = await api.createTasksBulk(value);
      if (res.tasks.length > 0) sounds.pop();
      await refreshTasks();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const toggle = async (task: Task) => {
    try {
      await api.updateTask(task.id, { status: task.status === "done" ? "todo" : "done" });
      await refreshTasks();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const hasNothing = openToday.length + doneToday.length === 0;

  return (
    <div className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-900">
      <div className="max-w-[680px] mx-auto px-6 py-8">
        <div className="mb-5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
            <Sunrise className="w-3 h-3" />
            Today&apos;s Stuff
          </div>
          <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            {format(new Date(), "EEEE, MMMM d")}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-stone-500 dark:text-stone-400">
            {openToday.length > 0
              ? `${openToday.length} thing${openToday.length === 1 ? "" : "s"} to do today`
              : "Nothing on the list yet — what's the plan?"}
          </p>
        </div>

        <div className="focus-aura mb-7 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-sm transition-shadow focus-within:shadow-md focus-within:shadow-stone-900/5">
          <div className="flex items-end gap-2 px-3.5 pt-2.5 pb-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape") {
                  setText("");
                  setItems(null);
                  setParsing(false);
                }
              }}
              rows={2}
              placeholder="What are you doing today? — e.g. finish the report, call mom at 6pm, buy milk #errands"
              className="flex-1 min-h-[44px] resize-none text-[13.5px] leading-relaxed outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 bg-transparent"
            />
            <button
              onClick={() => void submit()}
              disabled={!text.trim()}
              title="Add tasks (↵)"
              className="shrink-0 flex items-center gap-1.5 px-3 h-8 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[12.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-800 dark:hover:bg-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          {items && items.length > 0 && (
            <div className="px-3.5 pb-2.5">
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                {items.map((item, i) => (
                  <span
                    key={`${item.title}-${i}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-700/50 text-stone-600 dark:text-stone-300"
                  >
                    <Circle className="w-2.5 h-2.5 text-stone-400 shrink-0" strokeWidth={2.5} />
                    <span className="font-medium">{item.title || "(untitled)"}</span>
                    {item.project && <span className="text-blue-600">#{item.project}</span>}
                    {item.due && item.due !== today && (
                      <span className="flex items-center gap-0.5 text-stone-400 dark:text-stone-500">
                        <Calendar className="w-3 h-3" /> {dueLabel(item.due)}
                      </span>
                    )}
                    {item.priority !== "medium" && (
                      <Flag className={`w-3 h-3 ${PRIORITY_COLORS[item.priority]}`} />
                    )}
                    {item.recur && (
                      <span className="flex items-center gap-0.5 text-stone-400 dark:text-stone-500">
                        <Repeat2 className="w-3 h-3" /> {recurLabel(item.recur)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-500">
                Adds {items.length} task{items.length === 1 ? "" : "s"}
                {items.some((i) => !i.due || i.due === today) ? " — no date given, so due today" : ""}
              </p>
            </div>
          )}
          {parsing && !items && (
            <div className="px-3.5 pb-2.5 flex items-center gap-1.5 text-[12px] text-stone-400 dark:text-stone-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Reading…
            </div>
          )}
        </div>

        {openToday.length > 0 && (
          <Section title="Today" count={openToday.length} icon={<Flag className="w-3 h-3 text-red-500" />}>
            {openToday.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => void toggle(task)}
                onChanged={() => void refreshTasks()}
              />
            ))}
          </Section>
        )}

        {doneToday.length > 0 && (
          <Section title="Done today" count={doneToday.length} icon={<SquareCheck className="w-3 h-3 text-emerald-500" />}>
            {doneToday.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => void toggle(task)}
                onChanged={() => void refreshTasks()}
              />
            ))}
          </Section>
        )}

        {hasNothing && (
          <EmptyState
            icon={ListTodo}
            title="Nothing here yet"
            subtitle="Type what you want to do above — Persona parses it into tasks with due dates."
            actionLabel="Plan your day"
            onAction={() => textareaRef.current?.focus()}
          />
        )}
      </div>
    </div>
  );
}
