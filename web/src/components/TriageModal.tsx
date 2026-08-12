import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Sparkles,
  Flag,
  Calendar,
  Tag,
  Archive,
  Copy,
  Loader2,
  Check,
  RotateCcw,
} from "lucide-react";
import type { TriageKind, TriageSuggestion } from "../../../src/shared/types";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";

const KIND_META: Record<TriageKind, { label: string; icon: typeof Flag; className: string }> = {
  priority: { label: "Priority", icon: Flag, className: "text-red-500 bg-red-50 dark:bg-red-950/40" },
  due: { label: "Due date", icon: Calendar, className: "text-blue-500 bg-blue-50 dark:bg-blue-950/40" },
  project: { label: "Project", icon: Tag, className: "text-violet-500 bg-violet-50 dark:bg-violet-950/40" },
  stale: { label: "Stale", icon: Archive, className: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  duplicate: { label: "Duplicate", icon: Copy, className: "text-stone-500 bg-stone-100 dark:bg-stone-800" },
};

export default function TriageModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const tasks = useStore((s) => s.tasks);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const [suggestions, setSuggestions] = useState<TriageSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applyAllBusy, setApplyAllBusy] = useState(false);

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const run = async () => {
    setBusy(true);
    setError(null);
    setApplied(new Set());
    try {
      const res = await api.triageTasks();
      setSuggestions(res.suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Task triage failed");
      setSuggestions([]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (s: TriageSuggestion) => {
    if (!s.apply || busy) return;
    setApplied((prev) => new Set(prev).add(s.taskId));
    try {
      await api.updateTask(s.taskId, s.apply);
      sounds.pop();
      await refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply suggestion");
      setApplied((prev) => {
        const next = new Set(prev);
        next.delete(s.taskId);
        return next;
      });
    }
  };

  const applyAll = async () => {
    if (!suggestions || busy) return;
    const applicable = suggestions.filter((s) => s.apply && !applied.has(s.taskId));
    if (applicable.length === 0) return;
    setApplyAllBusy(true);
    setError(null);
    let ok = 0;
    for (const s of applicable) {
      try {
        await api.updateTask(s.taskId, s.apply as NonNullable<TriageSuggestion["apply"]>);
        ok++;
      } catch {
        // keep going; count failures silently
      }
    }
    if (ok > 0) sounds.pop();
    setApplied(new Set(suggestions.filter((s) => s.apply).map((s) => s.taskId)));
    setApplyAllBusy(false);
    await refreshTasks();
  };

  const close = () => {
    onClose();
    setSuggestions(null);
    setError(null);
    setApplied(new Set());
  };

  const applicableCount = suggestions?.filter((s) => s.apply && !applied.has(s.taskId)).length ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-900/10 dark:bg-black/40 backdrop-blur-[1px] z-50" />
        <Dialog.Content className="pop-in fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col bg-white dark:bg-stone-800 rounded-xl shadow-2xl shadow-stone-900/15 border border-stone-200 dark:border-stone-700 z-50">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                Task triage
              </Dialog.Title>
              <Dialog.Description className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                AI review of your open tasks — apply suggestions with one click.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close triage"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
            {suggestions === null && !busy && (
              <div className="py-10 flex flex-col items-center gap-3 text-center">
                <Sparkles className="w-8 h-8 text-blue-400" strokeWidth={1.3} />
                <p className="text-[13px] text-stone-500 dark:text-stone-400 max-w-[320px]">
                  Review your open tasks for wrong priorities, missing due dates,
                  stale or duplicate items.
                </p>
                <button
                  onClick={() => void run()}
                  className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Run triage
                </button>
              </div>
            )}

            {busy && suggestions === null && (
              <div className="py-10 flex flex-col items-center gap-3 text-stone-500 dark:text-stone-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <p className="text-[13px]">Reviewing {tasks.filter((t) => t.status === "todo").length} open tasks…</p>
              </div>
            )}

            {error && (
              <div className="text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}

            {busy && suggestions !== null && (
              <div className="flex items-center justify-center gap-2 py-2 text-[12px] text-stone-500 dark:text-stone-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                Re-reviewing tasks…
              </div>
            )}

            {suggestions !== null && !busy && suggestions.length === 0 && !error && (
              <div className="py-10 flex flex-col items-center gap-2 text-center">
                <Check className="w-8 h-8 text-emerald-500" strokeWidth={1.6} />
                <p className="text-[13.5px] text-stone-700 dark:text-stone-300 font-medium">
                  Your tasks look tidy
                </p>
                <p className="text-[12px] text-stone-400 dark:text-stone-500">
                  No suggestions right now. Run it again anytime.
                </p>
              </div>
            )}

            {suggestions !== null &&
              suggestions.map((s) => {
                const task = taskById.get(s.taskId);
                const meta = KIND_META[s.kind];
                const Icon = meta.icon;
                const isApplied = applied.has(s.taskId);
                return (
                  <div
                    key={`${s.taskId}:${s.kind}`}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                      isApplied
                        ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 opacity-70"
                        : "border-stone-200 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-700/20"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide shrink-0 ${meta.className}`}
                    >
                      <Icon className="w-2.5 h-2.5" />
                      {meta.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-stone-800 dark:text-stone-200 leading-snug">
                        {task ? (
                          <>
                            <span className="font-medium">{task.title}</span>
                            <span className="text-stone-400 dark:text-stone-500"> — </span>
                          </>
                        ) : null}
                        {s.suggestion}
                      </div>
                    </div>
                    {s.apply && (
                      <button
                        onClick={() => void apply(s)}
                        disabled={isApplied || busy}
                        className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
                          isApplied
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {isApplied ? (
                          <>
                            <Check className="w-3 h-3" /> Applied
                          </>
                        ) : (
                          "Apply"
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          {suggestions !== null && suggestions.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 dark:border-stone-800">
              <span className="text-[11.5px] text-stone-400 dark:text-stone-500">
                {applied.size} of {suggestions.filter((s) => s.apply).length} applied
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void run()}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-stone-700 text-[12px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/40 disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Re-run
                </button>
                <button
                  onClick={() => void applyAll()}
                  disabled={applyAllBusy || applicableCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applyAllBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Apply all ({applicableCount})
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
