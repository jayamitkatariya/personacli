import { useState } from "react";
import {
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  Loader,
  Bot,
  Cloud,
  Check,
  Sparkles,
} from "lucide-react";
import { useStore } from "../state/store";
import { api } from "../lib/api";

type Step = 1 | 2 | 3;
type AiChoice = "ollama" | "cloud" | "skip";

const STEP_LABELS = ["Workspace", "AI", "Done"] as const;

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 transition-shadow";

const labelClass =
  "block text-[12px] font-medium text-stone-700 dark:text-stone-300 mb-1.5";

export default function WelcomeScreen() {
  const settings = useStore((s) => s.settings);
  const reloadSettings = useStore((s) => s.reloadSettings);

  const [step, setStep] = useState<Step>(1);
  const [path, setPath] = useState(settings?.defaultWorkspace ?? "~/Persona");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiChoice, setAiChoice] = useState<AiChoice>(
    settings?.ai.local?.model ? "ollama" : "cloud",
  );
  const [provider, setProvider] = useState("OpenAI-compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [finishing, setFinishing] = useState(false);

  const local = settings?.ai.local ?? null;

  const pick = async () => {
    setBusy(true);
    try {
      const { path: picked } = await api.pickFolder();
      if (picked) setPath(picked);
    } finally {
      setBusy(false);
    }
  };

  const saveWorkspace = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ workspace: path.trim() });
      await reloadSettings();
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      if (aiChoice === "cloud") {
        await api.saveSettings({
          ai: {
            provider,
            baseUrl: baseUrl.trim(),
            model: model.trim(),
          },
          aiKey: apiKey.trim() || undefined,
        });
      }
      await reloadSettings();
      setStep(3);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await api.onboard();
      const store = useStore.getState();
      await store.refreshTree();
      await store.refreshTasks();
      await store.refreshPins();
      await store.openDoc("Notes/Welcome.md");
      store.setView("write");
      store.finishOnboarding();
    } catch {
      // Even if starter content fails, enter the workspace.
      useStore.getState().finishOnboarding();
    }
  };

  const canContinueAi = aiChoice !== "cloud" || Boolean(baseUrl.trim() && provider.trim());

  return (
    <div className="h-full flex items-center justify-center bg-stone-50 dark:bg-stone-900">
      <div className="w-[520px] max-w-[92vw]">
        <div className="text-center mb-6">
          <span className="gradient-text text-[26px] font-semibold tracking-tight select-none">
            Persona
          </span>
        </div>

        <div className="aura-border rounded-2xl shadow-xl shadow-stone-900/5 p-8">
          {/* step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {STEP_LABELS.map((label, i) => {
              const n = (i + 1) as Step;
              const active = step === n;
              const done = step > n;
              return (
                <div key={label} className="flex items-center gap-2">
                  {i > 0 && <div className={`w-6 h-px ${done ? "bg-blue-400" : "bg-stone-200 dark:bg-stone-700"}`} />}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-semibold ${
                        active
                          ? "bg-blue-600 text-white"
                          : done
                            ? "bg-emerald-500 text-white"
                            : "bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400"
                      }`}
                    >
                      {done ? <Check className="w-3 h-3" /> : n}
                    </span>
                    <span
                      className={`text-[11.5px] font-medium ${
                        active
                          ? "text-stone-900 dark:text-stone-100"
                          : "text-stone-400 dark:text-stone-500"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {step === 1 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 text-center">
                Welcome to Persona
              </h1>
              <p className="mt-2 text-[13px] text-stone-500 dark:text-stone-400 leading-relaxed text-center">
                Your local-first workspace. Notes, tasks and AI chat — all stored
                as plain Markdown files on your machine. No accounts, no cloud.
              </p>

              <label className={labelClass + " mt-6"}>
                Where should Persona store your workspace?
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveWorkspace()}
                  placeholder={settings?.defaultWorkspace ?? "~/Persona"}
                  className={inputClass + " flex-1"}
                />
                <button
                  onClick={() => void pick()}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-[12.5px] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50 shrink-0"
                >
                  {busy ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  Choose
                </button>
              </div>
              {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

              <div className="mt-4 rounded-lg bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/80 p-3.5">
                <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium mb-1.5">
                  Created on first run
                </div>
                <div className="flex flex-col gap-1 text-[12px] font-mono text-stone-600 dark:text-stone-400">
                  <span>Notes/</span>
                  <span>Projects/</span>
                  <span>.persona/tasks/</span>
                </div>
              </div>

              <button
                onClick={() => void saveWorkspace()}
                disabled={busy || !path.trim()}
                className="btn-aura mt-5 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-white text-[13.5px] font-medium disabled:opacity-50"
              >
                Continue
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <p className="mt-3 text-[11.5px] text-stone-400 dark:text-stone-500 text-center">
                This folder will be created if it doesn&apos;t exist. Existing
                files will appear in the sidebar untouched.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 text-center">
                Talk to an AI
              </h1>
              <p className="mt-2 text-[13px] text-stone-500 dark:text-stone-400 leading-relaxed text-center">
                Optional — chat, AI tags and task triage need a model. You can
                skip and set this up later in Settings (⌘,).
              </p>

              {local?.model ? (
                <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-3">
                  <Bot className="mt-0.5 w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div className="text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                    <span className="font-medium">
                      Connected — {local.name} ({local.model})
                    </span>
                    <span className="block mt-0.5 opacity-80">
                      Runs entirely on this machine. No API key needed.
                    </span>
                  </div>
                </div>
              ) : local ? (
                <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-3">
                  <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  <div className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                    <span className="font-medium">Ollama detected — no models installed</span>
                    <span className="block mt-0.5 opacity-80 break-all">
                      Pull one and it will be picked up automatically:{" "}
                      <code className="font-mono text-[11px]">ollama pull llama3.2</code>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 px-3.5 py-3">
                  <Sparkles className="mt-0.5 w-4 h-4 text-stone-400 shrink-0" />
                  <div className="text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
                    <span className="font-medium">No local AI detected</span>
                    <span className="block mt-0.5 opacity-80">
                      Ollama gives free, private chat with zero setup:{" "}
                      <code className="font-mono text-[11px]">brew install ollama</code>{" "}
                      then{" "}
                      <code className="font-mono text-[11px]">ollama pull llama3.2</code>.
                      Or add any OpenAI-compatible provider below.
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {local?.model && (
                  <ChoiceRow
                    active={aiChoice === "ollama"}
                    onSelect={() => setAiChoice("ollama")}
                    icon={<Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                    title="Use local Ollama"
                    subtitle={`${local.name} — ${local.model} · zero setup, no key`}
                  />
                )}
                <ChoiceRow
                  active={aiChoice === "cloud"}
                  onSelect={() => setAiChoice("cloud")}
                  icon={<Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                  title="Add an API key"
                  subtitle="Any OpenAI-compatible provider — OpenAI, OpenRouter, …"
                />
                <ChoiceRow
                  active={aiChoice === "skip"}
                  onSelect={() => setAiChoice("skip")}
                  icon={<ArrowRight className="w-4 h-4 text-stone-400" />}
                  title="Skip for now"
                  subtitle="Chat stays read-only until you add a model in Settings"
                />
              </div>

              {aiChoice === "cloud" && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Provider</label>
                    <input
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Model</label>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className={inputClass}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Base URL</label>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className={inputClass}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>API key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-…"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                      Stored in your macOS Keychain and only sent to this provider.
                    </p>
                  </div>
                </div>
              )}
              {aiError && <p className="mt-2 text-[12px] text-red-600">{aiError}</p>}

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  disabled={aiBusy}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-stone-200 dark:border-stone-700 text-[13px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  onClick={() => void saveAi()}
                  disabled={aiBusy || !canContinueAi}
                  className="btn-aura flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-white text-[13.5px] font-medium disabled:opacity-50"
                >
                  {aiBusy ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : aiChoice === "cloud" ? (
                    "Connect & continue"
                  ) : (
                    "Continue"
                  )}
                  {!aiBusy && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
                  <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                  You&apos;re all set
                </h1>
                <p className="mt-2 text-[13px] text-stone-500 dark:text-stone-400 leading-relaxed">
                  A Welcome note was created in your workspace with a quick tour
                  of the three views, keyboard shortcuts and the terminal
                  commands.
                </p>
              </div>

              <div className="mt-5 rounded-lg bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/80 divide-y divide-stone-200/80 dark:divide-stone-700/60">
                <SummaryRow
                  label="Workspace"
                  value={path.replace(/\/+$/, "")}
                  mono
                />
                <SummaryRow
                  label="AI"
                  value={
                    aiChoice === "skip"
                      ? "Skipped — add a model anytime in Settings (⌘,)"
                      : local?.model && aiChoice === "ollama"
                        ? `Local — ${local.name} (${local.model})`
                        : aiChoice === "cloud" && (apiKey.trim() || settings?.ai.hasKey)
                          ? `${provider} · ${model || "default model"}`
                          : "Will be detected automatically"
                  }
                />
              </div>

              <button
                onClick={() => void finish()}
                disabled={finishing}
                className="btn-aura mt-6 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-white text-[13.5px] font-medium disabled:opacity-50"
              >
                {finishing ? (
                  <Loader className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {finishing ? "Setting up…" : "Open my workspace"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChoiceRow({
  active,
  onSelect,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-start gap-3 px-3.5 py-2.5 rounded-lg border text-left transition-colors ${
        active
          ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50"
          : "border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600"
      }`}
    >
      <span
        className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          active
            ? "border-blue-600"
            : "border-stone-300 dark:border-stone-600"
        }`}
      >
        {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
      </span>
      {icon}
      <span className="flex-1">
        <span
          className={`block text-[13px] font-medium ${
            active
              ? "text-blue-900 dark:text-blue-100"
              : "text-stone-800 dark:text-stone-200"
          }`}
        >
          {title}
        </span>
        <span
          className={`block mt-0.5 text-[11.5px] ${
            active
              ? "text-blue-700/80 dark:text-blue-300/80"
              : "text-stone-500 dark:text-stone-400"
          }`}
        >
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <span className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium shrink-0">
        {label}
      </span>
      <span
        className={`text-[12.5px] text-stone-700 dark:text-stone-300 text-right truncate ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
