import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  X,
  FolderOpen,
  KeyRound,
  Check,
  Sun,
  Moon,
  Monitor,
  Folder,
  Sparkles,
  Bot,
  Cloud,
  Database,
  Palette,
  Type,
  ShieldCheck,
  Lock,
  Minus,
  Ligature,
  Settings,
  Loader,
  Trash2,
  Boxes,
  DownloadCloud,
} from "lucide-react";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { setSoundsEnabled, soundsEnabled, sounds } from "../lib/sounds";
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccent, normalizeAccent } from "../lib/accent";
import { applyTypography } from "../lib/typography";
import type { ChatBackend, Density, FontFamily, ImportPreview, ImportSource, LockSettings, ModuleKey, TypographySettings } from "../../../src/shared/types";
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
  {
    value: "workspace",
    label: "Workspace",
    icon: Folder,
    title: "Workspace",
    description: "Where your notes, projects and tasks live.",
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: Sun,
    title: "Appearance",
    description: "Theme, color scheme and typography.",
  },
  {
    value: "security",
    label: "Security",
    icon: ShieldCheck,
    title: "Security",
    description: "App lock and PIN protection.",
  },
  {
    value: "ai",
    label: "AI",
    icon: Sparkles,
    title: "AI",
    description: "Chat backend, models and embeddings.",
  },
  {
    value: "modules",
    label: "Modules",
    icon: Boxes,
    title: "Modules",
    description: "Choose which surfaces appear in the sidebar.",
  },
  {
    value: "import",
    label: "Import",
    icon: DownloadCloud,
    title: "Import",
    description: "Bring notes in from other apps.",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

let lastTabValue: TabValue = "workspace";

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 transition-shadow";

const labelClass = "block text-[12px] font-medium text-stone-700 dark:text-stone-300 mb-1.5";

const helperClass = "mt-1.5 text-[11.5px] text-stone-400 dark:text-stone-500";

const subClass = "text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5";

const primaryBtnClass =
  "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const secondaryBtnClass =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/60 disabled:opacity-50 transition-colors shrink-0";

const dangerBtnClass =
  "flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border text-[12.5px] transition-colors " +
  "border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30";

const dangerConfirmClass =
  "border-red-400 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300";

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${
        checked ? "bg-blue-600" : "bg-stone-200 dark:bg-stone-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center px-2 py-1.5 rounded-md border text-[11.5px] transition-colors ${
        active
          ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
          : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
      }`}
    >
      {children}
    </button>
  );
}

type NoteTone = "info" | "success" | "warn";

const NOTE_STYLES: Record<NoteTone, { box: string; text: string; dot: string }> = {
  info: {
    box: "border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30",
    text: "text-blue-800 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  success: {
    box: "border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30",
    text: "text-emerald-800 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  warn: {
    box: "border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
  },
};

function StatusNote({
  tone = "info",
  icon,
  title,
  children,
}: {
  tone?: NoteTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const s = NOTE_STYLES[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${s.box}`}>
      {icon ?? <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />}
      <div className={`text-[12px] leading-relaxed ${s.text}`}>
        {title && <span className="font-medium">{title}</span>}
        {children && <span className="block mt-0.5 opacity-80">{children}</span>}
      </div>
    </div>
  );
}

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const closeSettings = useStore((s) => s.closeSettings);
  const settings = useStore((s) => s.settings);
  const reloadSettings = useStore((s) => s.reloadSettings);

  const [tab, setTab] = useState<TabValue>(lastTabValue);
  const [workspace, setWorkspace] = useState("");
  const [provider, setProvider] = useState("OpenAI-compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [backend, setBackend] = useState<ChatBackend>("auto");
  const [theme, setTheme] = useState<Theme>("system");
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENT);
  const [typo, setTypo] = useState<TypographySettings>(DEFAULT_TYPOGRAPHY);
  const [lock, setLock] = useState<LockSettings | null>(null);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [idleInput, setIdleInput] = useState("5");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexInfo, setReindexInfo] = useState("");
  const [soundsOn, setSoundsOn] = useState(true);
  const [importSource, setImportSource] = useState<ImportSource>("obsidian");
  const [importPath, setImportPath] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [idleError, setIdleError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmRemovePin, setConfirmRemovePin] = useState(false);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState(false);
  const wasOpen = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accentDirty = useRef<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (accentTimer.current) clearTimeout(accentTimer.current);
      if (accentDirty.current) void api.saveSettings({ accent: accentDirty.current }).catch(() => {});
    };
  }, []);

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
        setLocalModel(settings.ai.ollamaModel ?? settings.ai.local?.model ?? "");
        setBackend(settings.ai.backend ?? "auto");
        setApiKey("");
        setTheme(settings.theme ?? "system");
        setAccent(settings.accent ?? DEFAULT_ACCENT);
        setTypo({ ...DEFAULT_TYPOGRAPHY, ...settings.typography });
        setSoundsOn(soundsEnabled());
        setWorkspaceError(null);
        setWorkspaceSaving(false);
        setAiError(null);
        setAiSaving(false);
        setIdleError(null);
        setPinError(null);
        setConfirmRemovePin(false);
        setConfirmRemoveKey(false);
        setReindexInfo("");
        void api
          .getLock()
          .then((l) => {
            setLock(l);
            setLockEnabled(l.enabled);
            setIdleInput(String(l.idleMinutes));
          })
          .catch(() => {});
      }
      wasOpen.current = true;
    } else {
      wasOpen.current = false;
      // Flush any debounced (in-flight) accent change before the modal hides,
      // so the last pick is never lost.
      if (accentTimer.current) {
        clearTimeout(accentTimer.current);
        accentTimer.current = null;
      }
      if (accentDirty.current) {
        void api.saveSettings({ accent: accentDirty.current }).catch(() => {});
        accentDirty.current = null;
      }
    }
  }, [open, settings]);

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const changeTab = (value: string) => {
    lastTabValue = value as TabValue;
    setTab(value as TabValue);
  };

  const saveWorkspace = async () => {
    const path = workspace.trim();
    if (!path || path === (settings?.workspace ?? "")) return;
    setWorkspaceSaving(true);
    setWorkspaceError(null);
    try {
      await api.saveSettings({ workspace: path });
      await reloadSettings();
      flashSaved();
    } catch (e) {
      setWorkspaceError((e as Error).message);
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const saveAi = async () => {
    setAiSaving(true);
    setAiError(null);
    try {
      await api.saveSettings({
        ai: {
          provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          embeddingModel: embeddingModel.trim(),
          backend,
          embeddingBaseUrl: embeddingBaseUrl.trim(),
          ollamaModel: localModel || undefined,
        },
        aiKey: apiKey || undefined,
        embeddingAiKey: embeddingApiKey || undefined,
      });
      setApiKey("");
      setEmbeddingApiKey("");
      await reloadSettings();
      flashSaved();
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiSaving(false);
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
    setWorkspaceError(null);
    try {
      const { path } = await api.pickFolder();
      if (path) setWorkspace(path);
    } catch (e) {
      setWorkspaceError((e as Error).message);
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

  // Applied immediately for live preview, then persisted with a short
  // debounce (a native color picker fires dozens of change events while
  // dragging — we only want one save at the end).
  const saveAccent = (value: string) => {
    const hex = normalizeAccent(value);
    setAccent(hex);
    applyAccent(hex);
    accentDirty.current = hex;
    if (accentTimer.current) clearTimeout(accentTimer.current);
    accentTimer.current = setTimeout(() => {
      accentTimer.current = null;
      const pending = accentDirty.current;
      accentDirty.current = null;
      if (pending) void api.saveSettings({ accent: pending }).catch(() => {});
    }, 300);
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
      setIdleInput(String(next.idleMinutes));
      if (patch.pin !== undefined) {
        setPin1("");
        setPin2("");
        setPinError(null);
      }
      flashSaved();
    } catch (e) {
      setPinError((e as Error).message);
    }
  };

  const saveIdle = () => {
    setIdleError(null);
    const n = Number(idleInput);
    if (!Number.isInteger(n) || n < 1 || n > 180) {
      setIdleError("Enter a whole number between 1 and 180.");
      return;
    }
    void saveLock({ idleMinutes: n });
  };

  const submitPin = () => {
    setPinError(null);
    const pin = pin1;
    if (pin.length < 4) {
      setPinError("PIN must be at least 4 characters.");
      return;
    }
    if (pin !== pin2) {
      setPinError("PINs don't match.");
      return;
    }
    void saveLock({ pin });
  };

  const pickImportPath = async () => {
    setImportError(null);
    try {
      const { path } = await api.pickFolder();
      if (path) setImportPath(path);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  const doPreview = async () => {
    if (!importPath.trim()) return;
    setImportBusy(true);
    setImportError(null);
    setImportPreview(null);
    setImportResult(null);
    try {
      setImportPreview(await api.importPreview(importSource, importPath.trim()));
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const doImport = async () => {
    if (!importPath.trim()) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await api.importRun(importSource, importPath.trim());
      setImportResult(`Imported ${result.notes} notes and ${result.attachments} attachments.`);
      setImportPreview(null);
      await reloadSettings();
      useStore.getState().refreshTree();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const toggleModule = (key: ModuleKey, value: boolean) => {
    void useStore.getState().setModules({ [key]: value });
  };

  const armConfirm = (setter: (v: boolean) => void) => {
    setter(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setter(false), 3000);
  };

  const activeTab = TABS.find((t) => t.value === tab) ?? TABS[0];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-900/10 dark:bg-black/40 backdrop-blur-[1px] z-50" />
        <Dialog.Content className="pop-in fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[94vw] h-[540px] max-h-[85vh] flex flex-col bg-white dark:bg-stone-800 rounded-xl shadow-2xl shadow-stone-900/15 border border-stone-200 dark:border-stone-700 z-50">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                <Settings className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <Dialog.Title className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                  Settings
                </Dialog.Title>
                <Dialog.Description className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                  Persona&apos;s preferences — stored on this machine.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close settings"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700/60 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <Tabs.Root
            value={tab}
            onValueChange={changeTab}
            orientation="vertical"
            className="flex-1 min-h-0 flex"
          >
            <Tabs.List
              aria-label="Settings sections"
              className="flex flex-col gap-0.5 w-[176px] shrink-0 px-2.5 py-3 border-r border-stone-100 dark:border-stone-800"
            >
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.value;
                return (
                  <Tabs.Trigger
                    key={t.value}
                    value={t.value}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                      active
                        ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium"
                        : "text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700/50"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {t.label}
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>

            <div className="flex-1 min-w-0 flex flex-col">
              <div className="px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800 shrink-0">
                <h2 className="text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
                  {activeTab.title}
                </h2>
                <p className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5">
                  {activeTab.description}
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                <Tabs.Content value="workspace" className="space-y-5 max-w-[430px]">
                  <div>
                    <label className={labelClass}>Workspace folder</label>
                    <div className="flex gap-2">
                      <input
                        value={workspace}
                        onChange={(e) => {
                          setWorkspace(e.target.value);
                          setWorkspaceError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && void saveWorkspace()}
                        placeholder="/Users/you/Persona"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => void pick()}
                        disabled={picking}
                        className={secondaryBtnClass}
                      >
                        {picking ? (
                          <Loader className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FolderOpen className="w-3.5 h-3.5" />
                        )}
                        {picking ? "…" : "Choose"}
                      </button>
                    </div>
                    <p className={helperClass}>
                      All notes, projects and tasks live here as plain Markdown files.
                    </p>
                  </div>
                  {workspaceError && <p className="text-[12px] text-red-600">{workspaceError}</p>}
                  <button
                    type="button"
                    onClick={() => void saveWorkspace()}
                    disabled={
                      workspaceSaving ||
                      !workspace.trim() ||
                      workspace.trim() === (settings?.workspace ?? "")
                    }
                    className={primaryBtnClass}
                  >
                    {workspaceSaving && <Loader className="w-3.5 h-3.5 animate-spin" />}
                    {workspaceSaving ? "Saving…" : "Save workspace"}
                  </button>
                </Tabs.Content>

                <Tabs.Content value="appearance" className="space-y-5 max-w-[430px]">
                  <div>
                    <label className={labelClass}>Theme</label>
                    <div className="grid grid-cols-3 gap-2">
                      {THEME_OPTIONS.map((o) => {
                        const Icon = o.icon;
                        const active = theme === o.value;
                        return (
                          <button
                            type="button"
                            key={o.value}
                            onClick={() => void saveTheme(o.value)}
                            className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-[12px] transition-colors ${
                              active
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className={helperClass}>System follows your macOS appearance.</p>
                  </div>

                  <div>
                    <label className={labelClass}>Color scheme</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {ACCENT_PRESETS.map((p) => (
                        <button
                          type="button"
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
                        <Palette className="absolute inset-0 m-auto w-3 h-3 text-white drop-shadow pointer-events-none" />
                      </label>
                      {accent !== DEFAULT_ACCENT && (
                        <button
                          type="button"
                          onClick={() => saveAccent(DEFAULT_ACCENT)}
                          className="text-[11.5px] text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline-offset-2 hover:underline"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <p className={helperClass}>
                      Pick a preset or choose any color — it re-themes the whole workspace.
                    </p>
                  </div>

                  <div>
                    <label className={labelClass}>Typography</label>
                    <div className="space-y-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-700/20 p-4">
                      <div>
                        <p className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                          Font family
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {FONT_OPTIONS.map((o) => (
                            <SegButton
                              key={o.value}
                              active={typo.fontFamily === o.value}
                              onClick={() => updateTypo({ fontFamily: o.value })}
                            >
                              {o.label}
                              <span className="text-[9.5px] opacity-60">{o.hint}</span>
                            </SegButton>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                          Base font size
                        </p>
                        <div className="grid grid-cols-4 gap-1.5">
                          {SIZE_OPTIONS.map((o) => (
                            <SegButton
                              key={o.value}
                              active={typo.fontSize === o.value}
                              onClick={() => updateTypo({ fontSize: o.value })}
                            >
                              {o.label}
                            </SegButton>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                          Density
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {DENSITY_OPTIONS.map((o) => (
                            <SegButton
                              key={o.value}
                              active={typo.density === o.value}
                              onClick={() => updateTypo({ density: o.value })}
                            >
                              {o.label}
                              <span className="text-[9.5px] opacity-60">{o.hint}</span>
                            </SegButton>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2.5 pt-3 border-t border-stone-200/70 dark:border-stone-700/60">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Type className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                            <span className="text-[11.5px] text-stone-600 dark:text-stone-400">
                              Serif for prose (Newsreader)
                            </span>
                          </div>
                          <Toggle
                            checked={typo.serifProse}
                            onChange={(v) => updateTypo({ serifProse: v })}
                            ariaLabel="Serif for prose"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Ligature className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                            <span className="text-[11.5px] text-stone-600 dark:text-stone-400">
                              Ligatures
                            </span>
                          </div>
                          <Toggle
                            checked={typo.ligatures}
                            onChange={(v) => updateTypo({ ligatures: v })}
                            ariaLabel="Ligatures"
                          />
                        </div>
                      </div>
                    </div>
                    <p className={helperClass}>
                      Inter and IBM Plex Sans are bundled variable fonts — nothing is loaded
                      from the network.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[12px] font-medium text-stone-700 dark:text-stone-300">
                        Sound effects
                      </p>
                      <p className={subClass}>
                        Soft feedback for completed actions. Respects Reduce Motion.
                      </p>
                    </div>
                    <Toggle
                      checked={soundsOn}
                      onChange={(v) => {
                        setSoundsOn(v);
                        setSoundsEnabled(v);
                        if (v) sounds.tick();
                      }}
                      ariaLabel="Sound effects"
                    />
                  </div>
                </Tabs.Content>

                <Tabs.Content value="security" className="space-y-5 max-w-[430px]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[12px] font-medium text-stone-700 dark:text-stone-300">
                        App lock
                      </p>
                      <p className={subClass}>
                        Re-lock this workspace with a PIN after a period of inactivity.
                      </p>
                    </div>
                    <Toggle
                      checked={lockEnabled}
                      onChange={(v) => void saveLock({ enabled: v })}
                      ariaLabel="App lock"
                    />
                  </div>

                  {lockEnabled && !lock?.hasPin && (
                    <StatusNote tone="warn" title="No PIN set yet">
                      Add a PIN below for the lock to take effect — it re-locks on launch and
                      after idle time.
                    </StatusNote>
                  )}

                  <div>
                    <label className={labelClass}>Lock after (minutes idle)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={idleInput}
                        onChange={(e) => {
                          setIdleInput(e.target.value.replace(/[^0-9]/g, ""));
                          setIdleError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && saveIdle()}
                        aria-label="Lock after minutes idle"
                        className={inputClass + " max-w-[110px]"}
                      />
                      <button type="button" onClick={saveIdle} className={secondaryBtnClass}>
                        Save
                      </button>
                    </div>
                    <p className={helperClass}>
                      Re-prompt after {idleInput || "…"} minute
                      {Number(idleInput) === 1 ? "" : "s"} without activity — or immediately when
                      you return to an idle window.
                    </p>
                    {idleError && <p className="mt-1.5 text-[12px] text-red-600">{idleError}</p>}
                  </div>

                  <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
                    <label className={labelClass}>PIN</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={pin1}
                        onChange={(e) => {
                          setPin1(e.target.value);
                          setPinError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && submitPin()}
                        placeholder={lock?.hasPin ? "New PIN (leave blank to keep)" : "Set a PIN"}
                        className={inputClass}
                      />
                      <input
                        type="password"
                        value={pin2}
                        onChange={(e) => {
                          setPin2(e.target.value);
                          setPinError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && submitPin()}
                        placeholder="Confirm PIN"
                        className={inputClass}
                      />
                    </div>
                    {pinError && <p className="mt-1.5 text-[12px] text-red-600">{pinError}</p>}
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={submitPin}
                        disabled={!pin1 || !pin2}
                        className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        {lock?.hasPin ? "Change PIN" : "Set PIN"}
                      </button>
                      {lock?.hasPin && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirmRemovePin) {
                              armConfirm(setConfirmRemovePin);
                              return;
                            }
                            setConfirmRemovePin(false);
                            void saveLock({ pin: "" });
                          }}
                          className={`${dangerBtnClass} ${confirmRemovePin ? dangerConfirmClass : ""}`}
                        >
                          <Minus className="w-3.5 h-3.5" />
                          {confirmRemovePin ? "Click again to confirm" : "Remove PIN"}
                        </button>
                      )}
                    </div>
                    <p className={helperClass}>
                      Stored in your macOS Keychain
                      {lock?.hasPin ? " (a PIN is set)" : " — the PIN is the only secret; it is never written to files"}
                      . The workspace re-locks on launch and after idle time.
                    </p>
                  </div>

                  {lockEnabled && lock?.hasPin && (
                    <StatusNote tone="success" title="Lock is active" icon={<ShieldCheck className="mt-0.5 w-4 h-4 shrink-0" />}>
                      You&apos;ll be asked for the PIN now and after{" "}
                      {Number(idleInput) || lock.idleMinutes} minute
                      {Number(idleInput) === 1 ? "" : "s"} idle.
                    </StatusNote>
                  )}
                </Tabs.Content>

                <Tabs.Content value="ai" className="space-y-5 max-w-[430px]">
                  <div>
                    <label className={labelClass}>Chat backend</label>
                    <div className="grid grid-cols-3 gap-2">
                      {BACKEND_OPTIONS.map((o) => {
                        const Icon = o.icon;
                        const active = backend === o.value;
                        return (
                          <button
                            type="button"
                            key={o.value}
                            onClick={() => setBackend(o.value)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] transition-colors ${
                              active
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span className="flex flex-col items-start leading-tight">
                              {o.label}
                              <span className={`text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>
                                {o.hint}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className={helperClass}>
                      Auto picks a configured provider, else a running local Ollama. Ollama runs
                      entirely on this machine — no API key needed.
                    </p>
                  </div>

                  {backend === "cloud" && settings?.ai.local && (
                    <StatusNote
                      tone="info"
                      icon={<Bot className="mt-0.5 w-4 h-4 shrink-0" />}
                      title={`Ollama detected — ${settings.ai.local.name}`}
                    >
                      Ignored while “API key” is the chat backend. Switch to Ollama to use it.
                    </StatusNote>
                  )}
                  {backend === "local" && !settings?.ai.local && (
                    <StatusNote tone="warn" title="Ollama is not running">
                      Start it, e.g.{" "}
                      <code className="font-mono text-[11px]">brew services start ollama</code>, or
                      switch the chat backend.
                    </StatusNote>
                  )}
                  {backend !== "cloud" && settings?.ai.local && (
                    <StatusNote
                      tone={settings.ai.local.model ? "success" : "warn"}
                      icon={
                        <Bot
                          className={`mt-0.5 w-4 h-4 shrink-0 ${
                            settings.ai.local.model
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        />
                      }
                      title={
                        settings.ai.local.model
                          ? `${settings.ai.local.name} — ${settings.ai.local.model}`
                          : "Ollama detected — no models installed"
                      }
                    >
                      {settings.ai.local.model ? (
                        backend === "local"
                          ? "Chat uses this local model — no API key needed."
                          : "Chat uses this local model while the backend is “Auto”. Pick “API key” to use your provider instead."
                      ) : (
                        <>
                          Pull one and it will be picked up automatically:{" "}
                          <code className="font-mono text-[11px]">ollama pull llama3.2</code>
                        </>
                      )}
                    </StatusNote>
                  )}

                  {backend !== "cloud" && (settings?.ai.local?.models?.length ?? 0) > 1 && (
                    <div>
                      <label className={labelClass}>Local model</label>
                      <div className="space-y-1.5">
                        {settings!.ai.local!.models!.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setLocalModel(m)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-[12.5px] transition-colors ${
                              localModel === m
                                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                                : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                            }`}
                          >
                            <span
                              className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                                localModel === m ? "border-blue-600" : "border-stone-300 dark:border-stone-600"
                              }`}
                            />
                            <span className="font-mono">{m}</span>
                          </button>
                        ))}
                      </div>
                      <p className={helperClass}>
                        Chat uses the selected local model. You can change it here anytime.
                      </p>
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
                      Stored in your macOS Keychain. Never written to files or sent anywhere
                      except your chosen provider.
                    </p>
                  </div>

                  <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
                    <p className="block text-[12.5px] font-medium text-stone-800 dark:text-stone-200 mb-2">
                      Embeddings (semantic search)
                    </p>
                    {!embeddingBaseUrl.trim() && settings?.ai.embeddingLocal ? (
                      <StatusNote
                        tone="success"
                        icon={
                          <Bot className="mt-0.5 w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        }
                        title={`Using local Ollama — ${settings.ai.embeddingLocal.model}`}
                      >
                        Notes are embedded on this machine. No API key needed.
                      </StatusNote>
                    ) : embeddingBaseUrl.trim() ? (
                      <StatusNote
                        tone="info"
                        icon={
                          <Database className="mt-0.5 w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        }
                        title="Embedding provider configured"
                      >
                        <span className="break-all">{embeddingBaseUrl}</span>
                      </StatusNote>
                    ) : (
                      <p className={helperClass + " mb-3"}>
                        Searches your notes by meaning — “that thing I wrote about camping”. A
                        running Ollama with an embedding model is used automatically, e.g.{" "}
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
                        Leave empty to auto-detect: local Ollama first, then your chat provider.
                        Set this when your chat provider (e.g. MiMo) offers no embeddings.
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
                      type="button"
                      onClick={() => void reindex()}
                      disabled={reindexing}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700/40 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/60 disabled:opacity-50 transition-colors"
                    >
                      {reindexing ? (
                        <Loader className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      {reindexing ? "Indexing…" : "Reindex all notes"}
                    </button>
                    {reindexInfo && (
                      <span className="text-[11.5px] text-stone-400 dark:text-stone-500 text-center">
                        {reindexInfo}
                      </span>
                    )}
                  </div>

                  <div className="pt-4 border-t border-stone-100 dark:border-stone-800 flex flex-col gap-3">
                    {aiError && <p className="text-[12px] text-red-600">{aiError}</p>}
                    <button
                      type="button"
                      onClick={() => void saveAi()}
                      disabled={aiSaving}
                      className={primaryBtnClass}
                    >
                      {aiSaving && <Loader className="w-3.5 h-3.5 animate-spin" />}
                      {aiSaving ? "Saving…" : "Save AI settings"}
                    </button>
                    {settings?.ai.hasKey && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmRemoveKey) {
                            armConfirm(setConfirmRemoveKey);
                            return;
                          }
                          setConfirmRemoveKey(false);
                          void api
                            .saveSettings({ aiKey: "" })
                            .then(() => reloadSettings())
                            .catch((e) => setAiError((e as Error).message));
                        }}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md transition-colors ${
                          confirmRemoveKey
                            ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                            : "text-red-500 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {confirmRemoveKey ? "Click again to confirm" : "Remove stored API key"}
                      </button>
                    )}
                  </div>
                </Tabs.Content>

                <Tabs.Content value="modules" className="space-y-4 max-w-[430px]">
                  {(
                    [
                      { key: "focus", title: "Focus timer", desc: "A shortcut to start a focus session." },
                      { key: "journal", title: "Journal", desc: "Quick-capture lines straight into today's note." },
                      { key: "today", title: "Today's Stuff", desc: "A daily planning view for due tasks." },
                      { key: "agents", title: "Agents", desc: "Background AI runs for multi-step tasks." },
                    ] as { key: ModuleKey; title: string; desc: string }[]
                  ).map((m) => (
                    <div key={m.key} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-medium text-stone-700 dark:text-stone-300">{m.title}</p>
                        <p className={subClass}>{m.desc}</p>
                      </div>
                      <Toggle
                        checked={settings?.modules?.[m.key] !== false}
                        onChange={(v) => toggleModule(m.key, v)}
                        ariaLabel={m.title}
                      />
                    </div>
                  ))}
                  <p className={helperClass}>
                    Disabled modules are hidden from the sidebar but stay available from ⌘K.
                  </p>
                </Tabs.Content>

                <Tabs.Content value="import" className="space-y-5 max-w-[430px]">
                  <div>
                    <label className={labelClass}>Source format</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { value: "obsidian", label: "Obsidian" },
                          { value: "bear", label: "Bear" },
                          { value: "roam", label: "Roam" },
                          { value: "notion", label: "Notion" },
                          { value: "plain", label: "Plain folder" },
                        ] as { value: ImportSource; label: string }[]
                      ).map((s) => (
                        <button
                          type="button"
                          key={s.value}
                          onClick={() => setImportSource(s.value)}
                          className={`px-3 py-2 rounded-lg border text-[12px] transition-colors ${
                            importSource === s.value
                              ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"
                              : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700/40"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Source folder or .zip</label>
                    <div className="flex gap-2">
                      <input
                        value={importPath}
                        onChange={(e) => setImportPath(e.target.value)}
                        placeholder="/path/to/export"
                        className={inputClass}
                      />
                      <button type="button" onClick={() => void pickImportPath()} className={secondaryBtnClass}>
                        Choose
                      </button>
                    </div>
                    <p className={helperClass}>
                      Imports land under <span className="font-mono">Imported/{importSource}/</span> and never
                      overwrite existing notes.
                    </p>
                  </div>

                  {importPreview && (
                    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3.5">
                      <p className="text-[12.5px] font-medium text-stone-700 dark:text-stone-300">
                        {importPreview.notes} notes · {importPreview.attachments} attachments
                      </p>
                      {importPreview.sample.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {importPreview.sample.map((s) => (
                            <p key={s} className="font-mono text-[11px] text-stone-500 dark:text-stone-400 truncate">
                              {s}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {importResult && <p className="text-[12px] text-emerald-600">{importResult}</p>}
                  {importError && <p className="text-[12px] text-red-600">{importError}</p>}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void doPreview()}
                      disabled={importBusy || !importPath.trim()}
                      className={secondaryBtnClass}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void doImport()}
                      disabled={importBusy || !importPath.trim()}
                      className={primaryBtnClass}
                    >
                      {importBusy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
                      Import
                    </button>
                  </div>
                </Tabs.Content>
              </div>
            </div>
          </Tabs.Root>

          {saved && (
            <div className="pop-in absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-900 px-3.5 py-1.5 text-[12px] text-emerald-700 dark:text-emerald-300 shadow-lg shadow-stone-900/10 z-10">
              <Check className="w-3.5 h-3.5" /> Saved
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
