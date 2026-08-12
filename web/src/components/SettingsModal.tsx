import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X, FolderOpen, KeyRound, Check, Sun, Moon, Monitor, Folder, Sparkles, Bot, Cloud, Database, Palette, Type, ShieldCheck, Lock, Minus, Ligature } from "lucide-react";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { setSoundsEnabled, soundsEnabled, sounds } from "../lib/sounds";
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccent, normalizeAccent } from "../lib/accent";
import { applyTypography } from "../lib/typography";
import type { ChatBackend, Density, FontFamily, LockSettings, TypographySettings } from "../../../src/shared/types";
import { DEFAULT_TYPOGRAPHY } from "../../../src/shared/types";

type Theme = "light" | "dark" | "system";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const BACKEND_OPTIONS: { value: ChatBackend; label: string; hint: string; icon: typeof Bot }[] = [
  { value: "auto", label: "Auto", hint: "Best available", icon: Sparkles },
  { value: "local", label: "Ollama", hint: "Local model", icon: Bot },
  { value: "cloud", label: "API key", hint: "Cloud provider", icon: Cloud },
];

const FONT_OPTIONS: { value: FontFamily; label: string; hint: string }[] = [
  { value: "inter", label: "Inter", hint: "Variable" },
  { value: "plex", label: "IBM Plex Sans", hint: "Variable" },
  { value: "system", label: "System", hint: "macOS stack" },
];

const SIZE_OPTIONS: { value: 13 | 14 | 15 | 16; label: string }[] = [
  { value: 13, label: "Small" },
  { value: 14, label: "Medium" },
  { value: 15, label: "Large" },
  { value: 16, label: "X-Large" },
];

const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "compact", label: "Compact", hint: "Tight" },
  { value: "comfortable", label: "Comfortable", hint: "Default" },
  { value: "spacious", label: "Spacious", hint: "Airy" },
];

const TABS = [
  { value: "workspace", label: "Workspace", icon: Folder },
  { value: "appearance", label: "Appearance", icon: Sun },
  { value: "security", label: "Security", icon: ShieldCheck },
  { value: "ai", label: "AI", icon: Sparkles },
];

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20 transition-shadow";

const labelClass =
  "block text-[12px] font-medium text-stone-600 dark:text-stone-400 mb-1.5";

const helperClass = "mt-1.5 text-[11.5px] text-stone-400 dark:text-stone-500";

const primaryBtnClass =
  "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const closeSettings = useStore((s) => s.closeSettings);
  const settings = useStore((s) => s.settings);
  const reloadSettings = useStore((s) => s.reloadSettings);

  const [workspace, setWorkspace] = useState("");
  const [provider, setProvider] = useState("OpenAI-compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [backend, setBackend] = useState<ChatBackend>("auto");
  const [theme, setTheme] = useState<Theme>("system");
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENT);
  const [typo, setTypo] = useState<TypographySettings>(DEFAULT_TYPOGRAPHY);
  const [lock, setLock] = useState<LockSettings | null>(null);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(5);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexInfo, setReindexInfo] = useState("");
  const [soundsOn, setSoundsOn] = useState(true);
  const wasOpen = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync form fields from settings only when the modal opens. Never re-sync
  // while it's open — saves call reloadSettings() and would otherwise wipe
  // whatever the user is editing.
  useEffect(() => {
    if (open && settings) {
      if (!wasOpen.current) {
        setWorkspace(settings.workspace);
        setProvider(settings.ai.provider);
        setBaseUrl(settings.ai.baseUrl);
        setModel(settings.ai.model);
        setEmbeddingModel(settings.ai.embeddingModel);
        setEmbeddingBaseUrl(settings.ai.embeddingBaseUrl);
        setEmbeddingApiKey("");
        setBackend(settings.ai.backend ?? "auto");
        setApiKey("");
        setTheme(settings.theme ?? "system");
        setAccent(settings.accent ?? DEFAULT_ACCENT);
        setTypo({ ...DEFAULT_TYPOGRAPHY, ...settings.typography });
        setSoundsOn(soundsEnabled());
        void api
          .getLock()
          .then((l) => {
            setLock(l);
            setLockEnabled(l.enabled);
            setIdleMinutes(l.idleMinutes);
          })
          .catch(() => {});
      }
      wasOpen.current = true;
    } else {
      wasOpen.current = false;
    }
  }, [open, settings]);

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const saveWorkspace = async () => {
    if (!workspace.trim()) return;
    try {
      await api.saveSettings({ workspace: workspace.trim() });
      await reloadSettings();
      flashSaved();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const saveAi = async () => {
    try {
      await api.saveSettings({
        ai: {
          provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          embeddingModel: embeddingModel.trim(),
          backend,
          embeddingBaseUrl: embeddingBaseUrl.trim(),
        },
        aiKey: apiKey || undefined,
        embeddingAiKey: embeddingApiKey || undefined,
      });
      setApiKey("");
      setEmbeddingApiKey("");
      await reloadSettings();
      flashSaved();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    setReindexInfo("");
    try {
      const result = await api.reindex();
      setReindexInfo(
        `Indexed ${result.files} note${result.files === 1 ? "" : "s"} · ${result.chunks} chunks`,
      );
    } catch (e) {
      setReindexInfo((e as Error).message);
    } finally {
      setReindexing(false);
    }
  };

  const pick = async () => {
    setPicking(true);
    try {
      const { path } = await api.pickFolder();
      if (path) setWorkspace(path);
    } finally {
      setPicking(false);
    }
  };

  const saveTheme = async (value: Theme) => {
    setTheme(value);
    try {
      await api.saveSettings({ theme: value });
      await reloadSettings();
      flashSaved();
    } catch {
      // theme is cosmetic — ignore save failures
    }
  };

  // Applied immediately for live preview, then persisted (server rounds-trips
  // back through the settings event, which re-applies the same accent).
  const saveAccent = (value: string) => {
    const hex = normalizeAccent(value);
    setAccent(hex);
    applyAccent(hex);
    void api.saveSettings({ accent: hex }).catch(() => {});
  };

  const updateTypo = (patch: Partial<TypographySettings>) => {
    const next = { ...typo, ...patch };
    setTypo(next);
    applyTypography(next);
    void api.saveSettings({ typography: patch }).catch(() => {});
  };

  const saveLock = async (patch: { enabled?: boolean; idleMinutes?: number; pin?: string }) => {
    try {
      const next = await api.saveLock(patch);
      setLock(next);
      setLockEnabled(next.enabled);
      setIdleMinutes(next.idleMinutes);
      if (patch.pin !== undefined) {
        setPin1("");
        setPin2("");
      }
      flashSaved();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-900/10 dark:bg-black/40 backdrop-blur-[1px] z-50" />
        <Dialog.Content className="pop-in fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] max-w-[92vw] max-h-[85vh] flex flex-col bg-white dark:bg-stone-800 rounded-xl shadow-2xl shadow-stone-900/15 border border-stone-200 dark:border-stone-700 z-50">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                Settings
              </Dialog.Title>
              <Dialog.Description className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                Configure your workspace and AI provider.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close settings"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <Tabs.Root defaultValue="workspace" className="flex-1 min-h-0 flex flex-col px-5 py-4">
            <Tabs.List className="flex gap-1 mb-5 p-0.5 rounded-lg bg-stone-100 dark:bg-stone-700/50 w-fit mx-auto">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <Tabs.Trigger
                    key={t.value}
                    value={t.value}
                    className="flex items-center gap-1.5 px-3 h-7 rounded-md text-[12.5px] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 data-[state=active]:bg-white dark:data-[state=active]:bg-stone-700 data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 data-[state=active]:shadow-sm transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>

            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="max-w-[380px] mx-auto">
              <Tabs.Content value="workspace" className="space-y-5">
                <div>
                  <label className={labelClass}>Workspace folder</label>
                  <div className="flex gap-2">
                    <input
                      value={workspace}
                      onChange={(e) => setWorkspace(e.target.value)}
                      placeholder="/Users/you/Persona"
                      className={inputClass}
                    />
                    <button
                      onClick={() => void pick()}
                      disabled={picking}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/60 disabled:opacity-50 transition-colors shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {picking ? "…" : "Choose"}
                    </button>
                  </div>
                  <p className={helperClass}>
                    All notes, projects and tasks live here as plain Markdown files.
                  </p>
                </div>
                <button onClick={() => void saveWorkspace()} className={primaryBtnClass}>
                  Save workspace
                </button>
              </Tabs.Content>

              <Tabs.Content value="appearance" className="space-y-5">
                <div>
                  <label className={labelClass}>Theme</label>
                  <div className="grid grid-cols-3 gap-2">
                    {THEME_OPTIONS.map((o) => {
                      const Icon = o.icon;
                      const active = theme === o.value;
                      return (
                        <button
                          key={o.value}
                          onClick={() => void saveTheme(o.value)}
                          className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-[12px] transition-colors ${
                            active
                              ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                              : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-stone-700/40 dark:hover:bg-stone-700/60"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className={helperClass}>
                    System follows your macOS appearance.
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Color scheme</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        title={p.label}
                        onClick={() => saveAccent(p.color)}
                        aria-label={`${p.label} color scheme`}
                        className={`w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${
                          accent === p.color
                            ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-stone-800 ring-stone-900 dark:ring-stone-100 scale-110"
                            : "ring-1 ring-stone-200 dark:ring-stone-600"
                        }`}
                        style={{ background: p.color }}
                      />
                    ))}
                    <label
                      title="Custom color"
                      className="relative w-7 h-7 rounded-full cursor-pointer ring-1 ring-stone-200 dark:ring-stone-600 overflow-hidden hover:ring-stone-400 transition-shadow"
                      style={{
                        background:
                          "conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)",
                      }}
                    >
                      <input
                        type="color"
                        value={accent}
                        onChange={(e) => saveAccent(e.target.value)}
                        aria-label="Custom color scheme"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <Palette className="absolute inset-0 m-auto w-3 h-3 text-white drop-shadow" />
                    </label>
                    {accent !== DEFAULT_ACCENT && (
                      <button
                        onClick={() => saveAccent(DEFAULT_ACCENT)}
                        className="text-[11.5px] text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline-offset-2 hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <p className={helperClass}>
                    Pick a preset or choose any color — it re-themes the whole
                    workspace, from buttons to the wordmark.
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Typography</label>
                  <div className="space-y-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-700/20 p-3.5">
                    <div>
                      <label className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                        Font family
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {FONT_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => updateTypo({ fontFamily: o.value })}
                            className={`flex flex-col items-center px-2 py-2 rounded-md border text-[11.5px] transition-colors ${
                              typo.fontFamily === o.value
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            {o.label}
                            <span className="text-[9.5px] opacity-60">{o.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                        Base font size
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {SIZE_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => updateTypo({ fontSize: o.value })}
                            className={`px-2 py-1.5 rounded-md border text-[11.5px] transition-colors ${
                              typo.fontSize === o.value
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                        Density
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {DENSITY_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => updateTypo({ density: o.value })}
                            className={`flex flex-col items-center px-2 py-1.5 rounded-md border text-[11.5px] transition-colors ${
                              typo.density === o.value
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            {o.label}
                            <span className="text-[9.5px] opacity-60">{o.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Type className="w-3.5 h-3.5 text-stone-400" />
                          <span className="text-[11.5px] text-stone-600 dark:text-stone-400">
                            Serif for prose (Newsreader)
                          </span>
                        </div>
                        <button
                          role="switch"
                          aria-checked={typo.serifProse}
                          onClick={() => updateTypo({ serifProse: !typo.serifProse })}
                          className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${
                            typo.serifProse ? "bg-blue-600" : "bg-stone-200 dark:bg-stone-700"
                          }`}
                          style={{ height: 18 }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              typo.serifProse ? "translate-x-3.5" : ""
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Ligature className="w-3.5 h-3.5 text-stone-400" />
                          <span className="text-[11.5px] text-stone-600 dark:text-stone-400">
                            Ligatures
                          </span>
                        </div>
                        <button
                          role="switch"
                          aria-checked={typo.ligatures}
                          onClick={() => updateTypo({ ligatures: !typo.ligatures })}
                          className={`relative w-8 rounded-full transition-colors shrink-0 ${
                            typo.ligatures ? "bg-blue-600" : "bg-stone-200 dark:bg-stone-700"
                          }`}
                          style={{ height: 18 }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              typo.ligatures ? "translate-x-3.5" : ""
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className={helperClass}>
                    Inter and IBM Plex Sans are bundled variable fonts — nothing
                    is loaded from the network.
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className={labelClass + " mb-0"}>Sound effects</label>
                      <p className={helperClass}>
                        Soft feedback for completed actions. Respects
                        Reduce Motion.
                      </p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={soundsOn}
                      onClick={() => {
                        const next = !soundsOn;
                        setSoundsOn(next);
                        setSoundsEnabled(next);
                        if (next) sounds.tick();
                      }}
                      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${
                        soundsOn
                          ? "bg-blue-600"
                          : "bg-stone-200 dark:bg-stone-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          soundsOn ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="security" className="space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className={labelClass + " mb-0"}>App lock</label>
                      <p className={helperClass}>
                        Re-lock this workspace with a PIN after a period of inactivity.
                      </p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={lockEnabled}
                      onClick={() => void saveLock({ enabled: !lockEnabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                        lockEnabled ? "bg-blue-600" : "bg-stone-200 dark:bg-stone-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          lockEnabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Lock after (minutes idle)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={idleMinutes}
                      onChange={(e) => setIdleMinutes(Number(e.target.value) || 5)}
                      className={inputClass + " max-w-[100px]"}
                    />
                    <button
                      onClick={() => void saveLock({ idleMinutes })}
                      className="px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                  <p className={helperClass}>
                    Re-prompt after {idleMinutes} minute{idleMinutes === 1 ? "" : "s"} without
                    activity — or immediately when you return to an idle window.
                  </p>
                </div>

                <div className="pt-1 border-t border-stone-100 dark:border-stone-800">
                  <label className={labelClass}>PIN</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={pin1}
                      onChange={(e) => setPin1(e.target.value)}
                      placeholder={lock?.hasPin ? "New PIN (leave blank to keep)" : "Set a PIN"}
                      className={inputClass}
                    />
                    <input
                      type="password"
                      value={pin2}
                      onChange={(e) => setPin2(e.target.value)}
                      placeholder="Confirm PIN"
                      className={inputClass}
                    />
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => {
                        const pin = pin1;
                        if (pin.length < 4) {
                          alert("PIN must be at least 4 characters.");
                          return;
                        }
                        if (pin !== pin2) {
                          alert("PINs don't match.");
                          return;
                        }
                        void saveLock({ pin });
                      }}
                      disabled={!pin1 || !pin2}
                      className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {lock?.hasPin ? "Change PIN" : "Set PIN"}
                    </button>
                    {lock?.hasPin && (
                      <button
                        onClick={() => {
                          if (confirm("Remove the PIN? The app will no longer lock.")) {
                            void saveLock({ pin: "" });
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                        Remove PIN
                      </button>
                    )}
                  </div>
                  <p className={helperClass}>
                    Stored in your macOS Keychain{lock?.hasPin ? " (a PIN is set)" : " — the PIN is the only secret; it is never written to files"}. The workspace
                    re-locks on launch and after idle time.
                  </p>
                </div>

                {lock?.enabled && lock.hasPin && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-3">
                    <ShieldCheck className="mt-0.5 w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                      <span className="font-medium">Lock is active</span>
                      <span className="block mt-0.5 opacity-80">
                        You&apos;ll be asked for the PIN now and after {idleMinutes} minute
                        {idleMinutes === 1 ? "" : "s"} idle.
                      </span>
                    </div>
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="ai" className="space-y-5">
                <div>
                  <label className={labelClass}>Chat backend</label>
                  <div className="grid grid-cols-3 gap-2">
                    {BACKEND_OPTIONS.map((o) => {
                      const Icon = o.icon;
                      const active = backend === o.value;
                      return (
                        <button
                          key={o.value}
                          onClick={() => setBackend(o.value)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] transition-colors ${
                            active
                              ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                              : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40 dark:hover:bg-stone-700/60"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="flex flex-col items-start leading-tight">
                            {o.label}
                            <span
                              className={`text-[10px] ${active ? "opacity-80" : "opacity-60"}`}
                            >
                              {o.hint}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className={helperClass}>
                    Auto picks a configured provider, else a running local Ollama.
                    Ollama runs entirely on this machine — no API key needed.
                  </p>
                </div>

                {backend === "cloud" && settings?.ai.local && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 px-3.5 py-3">
                    <Bot className="mt-0.5 w-4 h-4 text-stone-400 shrink-0" />
                    <div className="text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
                      <span className="font-medium">
                        Ollama detected — {settings.ai.local.name}
                      </span>
                      <span className="block mt-0.5 opacity-80">
                        Ignored while “API key” is the chat backend. Switch to
                        Ollama to use it.
                      </span>
                    </div>
                  </div>
                )}
                {backend === "local" && !settings?.ai.local && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-3.5 py-3">
                    <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                    <div className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                      <span className="font-medium">Ollama is not running</span>
                      <span className="block mt-0.5 opacity-80">
                        Start it, e.g.{" "}
                        <code className="font-mono text-[11px]">brew services start ollama</code>,
                        or switch the chat backend.
                      </span>
                    </div>
                  </div>
                )}
                {backend !== "cloud" && settings?.ai.local && (
                  <div
                    className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${
                      settings.ai.local.model
                        ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30"
                        : "border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30"
                    }`}
                  >
                    <span
                      className={`mt-1 w-2 h-2 rounded-full animate-pulse shrink-0 ${
                        settings.ai.local.model ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    <div
                      className={`text-[12px] leading-relaxed ${
                        settings.ai.local.model
                          ? "text-emerald-800 dark:text-emerald-300"
                          : "text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {settings.ai.local.model ? (
                        <>
                          <span className="font-medium">
                            {settings.ai.local.name} — {settings.ai.local.model}
                          </span>
                          <span className="block mt-0.5 opacity-80">
                            {backend === "local"
                              ? "Chat uses this local model — no API key needed."
                              : "Chat uses this local model while the backend is “Auto”. Pick “API key” to use your provider instead."}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">Ollama detected — no models installed</span>
                          <span className="block mt-0.5 opacity-80">
                            Pull one and it will be picked up automatically:{" "}
                            <code className="font-mono text-[11px]">ollama pull llama3.2</code>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Provider</label>
                    <input
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                      Any OpenAI-compatible provider: OpenAI, OpenRouter, Ollama, custom…
                    </p>
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
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>API key</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={settings?.ai.hasKey ? "••••••••  (stored)" : "sk-…"}
                      className={inputClass}
                    />
                    {settings?.ai.hasKey && (
                      <span className="flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400 shrink-0">
                        <KeyRound className="w-3 h-3" /> stored
                      </span>
                    )}
                  </div>
                  <p className={helperClass}>
                    Stored in your macOS Keychain. Never written to files or sent
                    anywhere except your chosen provider.
                  </p>
                </div>
                <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
                  <label className={labelClass}>Embeddings (semantic search)</label>
                  {!embeddingBaseUrl.trim() && settings?.ai.embeddingLocal ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-3 mb-3">
                      <Bot className="mt-0.5 w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                        <span className="font-medium">
                          Using local Ollama — {settings.ai.embeddingLocal.model}
                        </span>
                        <span className="block mt-0.5 opacity-80">
                          Notes are embedded on this machine. No API key needed.
                        </span>
                      </div>
                    </div>
                  ) : embeddingBaseUrl.trim() ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-3.5 py-3 mb-3">
                      <Database className="mt-0.5 w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div className="text-[12px] leading-relaxed text-blue-800 dark:text-blue-300">
                        <span className="font-medium">Embedding provider configured</span>
                        <span className="block mt-0.5 opacity-80 break-all">{embeddingBaseUrl}</span>
                      </div>
                    </div>
                  ) : (
                    <p className={helperClass + " mb-3"}>
                      Searches your notes by meaning — “that thing I wrote about
                      camping”. A running Ollama with an embedding model is used
                      automatically, e.g.{" "}
                      <code className="font-mono text-[11px]">ollama pull all-minilm</code>.
                    </p>
                  )}
                  <div>
                    <label className={labelClass}>Embedding base URL (optional)</label>
                    <input
                      value={embeddingBaseUrl}
                      onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
                      placeholder="http://127.0.0.1:11434/v1"
                      className={inputClass}
                    />
                    <p className={helperClass}>
                      Leave empty to auto-detect: local Ollama first, then your chat
                      provider. Set this when your chat provider (e.g. MiMo) offers
                      no embeddings.
                    </p>
                  </div>
                  <div className="mt-3">
                    <label className={labelClass}>Embedding API key (optional)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={embeddingApiKey}
                        onChange={(e) => setEmbeddingApiKey(e.target.value)}
                        placeholder={settings?.ai.embeddingHasKey ? "••••••••  (stored)" : "sk-…"}
                        className={inputClass}
                      />
                      {settings?.ai.embeddingHasKey && (
                        <span className="flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400 shrink-0">
                          <KeyRound className="w-3 h-3" /> stored
                        </span>
                      )}
                    </div>
                    <p className={helperClass}>
                      Not needed for Ollama. Leave empty to reuse your main API key.
                    </p>
                  </div>
                  <div className="mt-3">
                    <label className={labelClass}>Embedding model</label>
                    <input
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      placeholder="text-embedding-3-small"
                      className={inputClass}
                    />
                    <p className={helperClass}>
                      Used when an explicit embedding base URL is set above.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void reindex()}
                    disabled={reindexing}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/60 disabled:opacity-50 transition-colors"
                  >
                    {reindexing ? "Indexing…" : "Reindex all notes"}
                  </button>
                  {reindexInfo && (
                    <span className="text-[11.5px] text-stone-400 dark:text-stone-500 text-center">
                      {reindexInfo}
                    </span>
                  )}
                </div>
                <div className="pt-1 border-t border-stone-100 dark:border-stone-800 flex flex-col gap-3">
                  <button onClick={() => void saveAi()} className={primaryBtnClass}>
                    Save AI settings
                  </button>
                  {settings?.ai.hasKey && (
                    <button
                      onClick={() => {
                        if (confirm("Remove the stored API key?")) {
                          void api.saveSettings({ aiKey: "" }).then(() => reloadSettings());
                        }
                      }}
                      className="w-full flex items-center justify-center px-3 py-1.5 text-[12px] text-red-500 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
                    >
                      Remove key
                    </button>
                  )}
                </div>
              </Tabs.Content>
              </div>
            </div>
          </Tabs.Root>

          {saved && (
            <div className="pop-in fixed bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-900 px-3.5 py-1.5 text-[12px] text-emerald-700 dark:text-emerald-300 shadow-lg shadow-stone-900/10">
              <Check className="w-3.5 h-3.5" /> Saved
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
