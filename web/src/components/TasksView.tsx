import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  SquareCheck,
  ChevronDown,
  Calendar,
  Tag,
  Flag,
  ListTodo,
  Plus,
  Download,
  FileDown,
  Repeat2,
  Sparkles,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";
import type { Task, TaskPriority, TaskRecur } from "../../../src/shared/types";
import { Section, TaskRow, dueLabel, recurLabel, useTaskCelebration, PRIORITY_COLORS } from "./TaskRow";
import EmptyState from "./EmptyState";
import TriageModal from "./TriageModal";

function groupTasks(tasks: Task[]) {
  const today = format(new Date(), "yyyy-MM-dd");
  const todayTasks: Task[] = [];
  const upcoming: Task[] = [];
  const completed: Task[] = [];
  for (const task of tasks) {
    if (task.status === "done") {
      completed.push(task);
    } else if (task.due && task.due <= today) {
      todayTasks.push(task);
    } else {
      upcoming.push(task);
    }
  }
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  todayTasks.sort(byDue);
  upcoming.sort(byDue);
  return { todayTasks, upcoming, completed };
}

export default function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const composerFocus = useStore((s) => s.taskComposerFocus);
  const projectFilter = useStore((s) => s.taskProjectFilter);
  const setProjectFilter = useStore((s) => s.setTaskProjectFilter);
  const focusTaskComposer = useStore((s) => s.focusTaskComposer);

  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ title: string; due: string | null; priority: TaskPriority; project: string | null; recur: TaskRecur | null } | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Celebrate todo → done transitions (chime + confetti).
  useTaskCelebration(tasks);

  const exportList = (format: "pdf" | "docx") => {
    void api.exportTasks(format, projectFilter).catch((e) => alert((e as Error).message));
  };

  useEffect(() => {
    if (composerFocus > 0) inputRef.current?.focus();
  }, [composerFocus]);

  useEffect(() => {
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setParsed(await api.parseTask(text));
      } catch {
        setParsed(null);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [text]);

  const { todayTasks, upcoming, completed } = useMemo(() => groupTasks(tasks), [tasks]);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.project) set.add(t.project);
    return [...set].sort();
  }, [tasks]);

  const visibleToday = projectFilter ? todayTasks.filter((t) => t.project === projectFilter) : todayTasks;
  const visibleUpcoming = projectFilter ? upcoming.filter((t) => t.project === projectFilter) : upcoming;
  const visibleCompleted = projectFilter ? completed.filter((t) => t.project === projectFilter) : completed;

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    setParsed(null);
    try {
      await api.createTask(value);
      sounds.pop();
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

  const filtered = (list: Task[]) =>
    list.map((task) => (
      <TaskRow key={task.id} task={task} onToggle={() => void toggle(task)} onChanged={() => void refreshTasks()} />
    ));

  return (
    <div className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-900">
      <div className="max-w-[680px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
              <SquareCheck className="w-3 h-3" />
              Tasks
            </div>
            <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Your personal task list
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTriageOpen(true)}
              title="AI task triage"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-[12.5px] text-stone-600 dark:text-stone-400 hover:text-blue-600 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              Triage
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  title="Export task list"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-[12.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/60"
                >
                  <Download className="w-3 h-3" />
                  Export
                  <ChevronDown className="w-3 h-3 text-stone-400 dark:text-stone-500" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="min-w-[150px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                >
                  {(
                    [
                      { format: "pdf", label: "Export as PDF" },
                      { format: "docx", label: "Export as DOCX" },
                    ] as const
                  ).map((item) => (
                    <DropdownMenu.Item
                      key={item.format}
                      onSelect={() => exportList(item.format)}
                      className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                    >
                      <span className="flex items-center gap-2">
                        <FileDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                        {item.label}
                      </span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            {projects.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-[12.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/60">
                  <Tag className="w-3 h-3" />
                  {projectFilter ?? "All projects"}
                  <ChevronDown className="w-3 h-3 text-stone-400 dark:text-stone-500" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="min-w-[160px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                >
                  <DropdownMenu.Item
                    onSelect={() => setProjectFilter(null)}
                    className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                  >
                    All projects
                  </DropdownMenu.Item>
                  {projects.map((p) => (
                    <DropdownMenu.Item
                      key={p}
                      onSelect={() => setProjectFilter(p)}
                      className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                    >
                      #{p}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            )}
          </div>
        </div>

        <div className="focus-aura mb-7 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-sm transition-shadow focus-within:shadow-md focus-within:shadow-stone-900/5">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <Plus className="w-4 h-4 text-stone-400 dark:text-stone-500" />
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") setText("");
              }}
              placeholder="Add task — e.g. Buy domain tomorrow #personal !!"
              className="flex-1 text-[13.5px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 bg-transparent"
            />
          </div>
          {parsed && (
            <div className="px-3.5 pb-2.5 text-[12px] text-stone-500 dark:text-stone-400 flex items-center gap-2 flex-wrap">
              <span className="font-medium text-stone-700 dark:text-stone-300">{parsed.title || "(untitled)"}</span>
              {parsed.project && <span className="text-blue-600">#{parsed.project}</span>}
              {parsed.due && (
                <span className="flex items-center gap-0.5">
                  <Calendar className="w-3 h-3" /> {dueLabel(parsed.due)}
                </span>
              )}
              {parsed.priority !== "medium" && (
                <span className="flex items-center gap-0.5">
                  <Flag className={`w-3 h-3 ${PRIORITY_COLORS[parsed.priority]}`} />
                  {parsed.priority}
                </span>
              )}
              {parsed.recur && (
                <span className="flex items-center gap-0.5">
                  <Repeat2 className="w-3 h-3" /> {recurLabel(parsed.recur)}
                </span>
              )}
            </div>
          )}
        </div>

        {visibleToday.length > 0 && (
          <Section title="Today" count={visibleToday.length} icon={<Flag className="w-3 h-3 text-red-500" />}>
            {filtered(visibleToday)}
          </Section>
        )}
        {visibleUpcoming.length > 0 && (
          <Section title="Upcoming" count={visibleUpcoming.length} icon={<Calendar className="w-3 h-3 text-blue-500" />}>
            {filtered(visibleUpcoming)}
          </Section>
        )}
        {visibleCompleted.length > 0 && (
          <Section title="Completed" count={visibleCompleted.length} icon={<SquareCheck className="w-3 h-3 text-emerald-500" />}>
            {filtered(visibleCompleted)}
          </Section>
        )}
        {visibleToday.length + visibleUpcoming.length + visibleCompleted.length === 0 && (
          <EmptyState
            icon={ListTodo}
            title={projectFilter ? "No tasks in this project" : "No tasks yet"}
            subtitle={
              projectFilter
                ? "Try another project, or clear the filter."
                : "Capture anything on your mind — dates, priorities and projects are parsed for you."
            }
            actionLabel="Add a task"
            onAction={() => {
              if (projectFilter) setProjectFilter(null);
              focusTaskComposer();
            }}
          >
            {!projectFilter && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium mb-2">
                  Try one
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(
                    [
                      "Buy domain tomorrow #personal !!",
                      "Water plants every week",
                      "Review PRD by Friday #project",
                    ] as const
                  ).map((example) => (
                    <button
                      key={example}
                      onClick={() => {
                        setText(example);
                        inputRef.current?.focus();
                      }}
                      className="px-3 py-1.5 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[12px] text-stone-600 dark:text-stone-400 hover:border-blue-300 dark:hover:border-blue-800 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </EmptyState>
        )}
      </div>

      <TriageModal open={triageOpen} onClose={() => setTriageOpen(false)} />
    </div>
  );
}
