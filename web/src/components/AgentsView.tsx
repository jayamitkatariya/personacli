import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Bot,
  Check,
  Loader2,
  RotateCcw,
  Square,
  Trash2,
  Workflow,
} from "lucide-react";
import { useStore } from "../state/store";
import Markdown from "./Markdown";
import EmptyState from "./EmptyState";
import type { AgentRun, ContextTarget } from "../../../src/shared/types";

const STATUS_STYLES: Record<AgentRun["status"], string> = {
  queued: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
  running: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300",
  cancelled: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
};

const TOOL_LABELS: Record<string, string> = {
  list_folder: "Browsing folder",
  read_note: "Reading file",
  create_note: "Creating note",
  write_note: "Writing note",
  append_note: "Appending to note",
  create_folder: "Creating folder",
  list_tasks: "Listing tasks",
  create_task: "Creating task",
  update_task: "Updating task",
  delete_task: "Deleting task",
  move_file: "Moving file",
  rename_file: "Renaming file",
  delete_file: "Deleting file",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return format(new Date(ms), "MMM d");
}

export default function AgentsView() {
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const createAgent = useStore((s) => s.createAgent);
  const cancelAgent = useStore((s) => s.cancelAgent);
  const retryAgent = useStore((s) => s.retryAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const aiReady = Boolean(settings?.ai.hasKey || settings?.ai.local?.model);

  const submit = async () => {
    const value = prompt.trim();
    if (!value || busy) return;
    setBusy(true);
    setPrompt("");
    try {
      const contexts: ContextTarget[] = [];
      await createAgent(value, contexts);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-stone-50 dark:bg-stone-900">
      <div className="max-w-[720px] mx-auto px-6 py-8">
        <div className="mb-5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-[11px] font-medium">
            <Workflow className="w-3 h-3" />
            Agents
          </div>
          <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Background runs
          </h1>
          <p className="mt-0.5 text-[12.5px] text-stone-500 dark:text-stone-400">
            Give Persona a multi-step task and it works through it without holding a chat open.
          </p>
        </div>

        <div className="focus-aura mb-7 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-sm p-3">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="e.g. Organize my inbox notes into folders by topic"
            className="w-full resize-none text-[13.5px] leading-relaxed outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 bg-transparent"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
              {aiReady ? "Runs one at a time" : "Requires an AI model"}
            </span>
            <button
              onClick={() => void submit()}
              disabled={!prompt.trim() || busy || !aiReady}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
              Run agent
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No agent runs yet"
            subtitle="Start a background task above and it will appear here with live status."
          />
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onRefresh={refreshAgents}
                onCancel={() => void cancelAgent(agent.id)}
                onRetry={() => void retryAgent(agent.id)}
                onDelete={() => void deleteAgent(agent.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onRefresh,
  onCancel,
  onRetry,
  onDelete,
}: {
  agent: AgentRun;
  onRefresh: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const active = agent.status === "running" || agent.status === "queued";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(onRefresh, 1500);
    return () => clearInterval(t);
  }, [active, onRefresh]);

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center shrink-0">
          {active ? (
            <Loader2 className="w-4 h-4 text-violet-600 animate-spin" />
          ) : (
            <Bot className="w-4 h-4 text-violet-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium ${STATUS_STYLES[agent.status]}`}>
              {agent.status === "done" ? <Check className="w-3 h-3" /> : null}
              {agent.status}
            </span>
            <span className="text-[11px] text-stone-400 dark:text-stone-500">
              {relativeTime(agent.createdAt)}
            </span>
          </div>
          <p className="mt-1.5 text-[13.5px] text-stone-800 dark:text-stone-200 whitespace-pre-wrap">
            {agent.prompt}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {active ? (
            <button onClick={onCancel} title="Cancel" className="p-1.5 rounded-md text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={onRetry} title="Retry" className="p-1.5 rounded-md text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                setTimeout(() => setConfirmingDelete(false), 3000);
                return;
              }
              onDelete();
            }}
            title="Delete"
            className={`p-1.5 rounded-md ${
              confirmingDelete
                ? "bg-red-50 dark:bg-red-950/30 text-red-600"
                : "text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {agent.steps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.steps.map((step, i) => (
            <span
              key={i}
              title={step.detail}
              className={`flex items-center gap-1.5 text-[10.5px] rounded-full border px-2 py-0.5 ${
                step.status === "done"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                  : "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"
              }`}
            >
              {step.status === "done" ? <Check className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
              {toolLabel(step.name)}
            </span>
          ))}
        </div>
      )}

      {agent.error && (
        <div className="mt-3 text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
          {agent.error}
        </div>
      )}

      {agent.result && (
        <div className="mt-3 text-[13.5px] leading-relaxed text-stone-700 dark:text-stone-300 md-body">
          <Markdown content={agent.result} />
        </div>
      )}
    </div>
  );
}
