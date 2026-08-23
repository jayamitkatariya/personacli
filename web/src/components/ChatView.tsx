import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Send,
  Square,
  X,
  FileText,
  Folder,
  SquareCheck,
  Trash2,
  Check,
  Copy,
  Loader2,
  ImagePlus,
  Mic,
  Sparkles,
  Undo2,
  Languages,
  MessageCircle,
  TextQuote,
  RefreshCw,
  Pencil,
  GitFork,
  PenLine,
  Cpu,
  ShieldAlert,
  FolderOpen,
  Thermometer,
  ChevronDown,
} from "lucide-react";
import { useStore } from "../state/store";
import { api, streamTransform } from "../lib/api";
import { sounds } from "../lib/sounds";
import Markdown from "./Markdown";
import EmptyState from "./EmptyState";
import type { ContextItem, ContextTarget, TransformMode } from "../../../src/shared/types";

const MAX_IMAGES = 4;
const MAX_IMAGE_DIMENSION = 2048;

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (file.type === "image/svg+xml") {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function itemIcon(item: ContextItem) {
  if (item.type === "tasks") return SquareCheck;
  if (item.type === "folder") return Folder;
  return FileText;
}

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={copied ? "Copied" : "Copy"}
      className={`p-1 rounded-md transition-colors ${
        copied
          ? "text-emerald-500"
          : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
      }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function ChatView() {
  const messages = useStore((s) => s.messages);
  const currentChatId = useStore((s) => s.currentChatId);
  const updateMessage = useStore((s) => s.updateMessage);
  const setCurrentChatId = useStore((s) => s.setCurrentChatId);
  const startNewChat = useStore((s) => s.startNewChat);
  const refreshChats = useStore((s) => s.refreshChats);
  const openDocAtLine = useStore((s) => s.openDocAtLine);
  const settings = useStore((s) => s.settings);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshTasks = useStore((s) => s.refreshTasks);

  const [input, setInput] = useState("");
  const [contexts, setContexts] = useState<ContextTarget[]>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ContextItem[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasQueuedOrStreaming = messages.some((m) => m.role === "assistant" && (m.status === "queued" || m.status === "streaming"));
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [rewriting, setRewriting] = useState<{ id: string; abort: AbortController } | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const failedEnqueues = useStore((s) => s.failedEnqueues);
  const personas = useStore((s) => s.personas);
  const chatSettings = useStore((s) => s.chatSettings);
  const setChatSettings = useStore((s) => s.setChatSettings);

  const profiles = settings?.ai.profiles ?? [];
  const activePersonaId = chatSettings.personaId ?? "default";
  const activePersonaName = personas.find((p) => p.id === activePersonaId)?.name ?? "Default";
  const activeModelLabel = chatSettings.modelId
    ? (profiles.find((p) => p.id === chatSettings.modelId)?.label ?? "Custom model")
    : "Auto";
  const tempPresets = [
    { value: null, label: "Auto" },
    { value: 0, label: "0 · precise" },
    { value: 0.3, label: "0.3" },
    { value: 0.7, label: "0.7" },
    { value: 1, label: "1 · wild" },
  ] as const;
  const activeTemp = tempPresets.find((t) =>
    t.value === null ? chatSettings.temperature == null : t.value === chatSettings.temperature,
  );

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledUpRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const micBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const micFailedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Background queue persists in chat-jobs; keep a lightweight title sync only when idle.
  useEffect(() => {
    if (messages.length === 0 || hasQueuedOrStreaming) return;
    const timer = setTimeout(async () => {
      const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
      const title = firstUser.replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled chat";
      let id = useStore.getState().currentChatId;
      if (!id) {
        id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        setCurrentChatId(id);
      }
      await api.saveChat(id, title, messages).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [messages, hasQueuedOrStreaming, setCurrentChatId]);

  useEffect(() => {
    if (scrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, hasQueuedOrStreaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    scrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mentionQuery === null) return;
    const t = setTimeout(async () => {
      try {
        const items = await api.context(mentionQuery);
        setSuggestions(items);
        setSuggestionIndex(0);
      } catch {
        setSuggestions([]);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [mentionQuery]);

  const onInputChange = (value: string) => {
    setInput(value);
    const at = value.lastIndexOf("@");
    if (at !== -1) {
      const after = value.slice(at + 1);
      if (!/\s/.test(after)) {
        setMentionQuery(after);
        return;
      }
    }
    setMentionQuery(null);
    setSuggestions([]);
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((it) => it.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const dataUrl = await readImageFile(file);
        setPendingImages((prev) =>
          prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl],
        );
      } catch {
        // ignore unreadable image
      }
    }
    inputRef.current?.focus();
  };

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      try {
        const dataUrl = await readImageFile(file);
        setPendingImages((prev) =>
          prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl],
        );
      } catch {
        // ignore unreadable image
      }
    }
    inputRef.current?.focus();
  };

  const selectSuggestion = (item: ContextItem) => {
    const at = input.lastIndexOf("@");
    const prefix = at === -1 ? input : input.slice(0, at);
    setInput(prefix);
    setMentionQuery(null);
    setSuggestions([]);
    const target: ContextTarget =
      item.type === "file"
        ? { type: "file", path: item.path }
        : item.type === "folder"
          ? { type: "folder", path: item.path }
          : { type: "tasks", path: "" };
    setContexts((prev) => [...prev, target]);
    inputRef.current?.focus();
  };

  const stopRecording = () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const finishRecording = async () => {
    if (!mountedRef.current || micFailedRef.current) return;
    const type = recorderRef.current?.mimeType ?? "audio/webm";
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    if (blob.size === 0) return;
    setTranscribing(true);
    try {
      const { text } = await api.transcribeAudio(blob);
      if (text) {
        setInput((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${text}` : text));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      if (mountedRef.current) {
        setTranscribing(false);
        inputRef.current?.focus();
      }
    }
  };

  const toggleMic = async () => {
    if (transcribing || hasQueuedOrStreaming || micBusyRef.current) return;
    if (listening) {
      setListening(false);
      stopRecording();
      return;
    }
    micBusyRef.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micBusyRef.current = false;
      setError("Microphone access was denied. Allow mic access in your browser settings, then try again.");
      return;
    }
    micBusyRef.current = false;
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    micFailedRef.current = false;
    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/mp4";
    const recorder = new MediaRecorder(stream, mimeType === "audio/mp4" ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      void finishRecording();
    };
    recorder.onerror = () => {
      setListening(false);
      setError("Recording failed. Try again.");
      micFailedRef.current = true;
      if (recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      if (streamRef.current === stream) streamRef.current = null;
    };
    recorder.start();
    setListening(true);
    stopTimerRef.current = window.setTimeout(() => {
      setListening(false);
      stopRecording();
    }, 120_000);
  };

  const send = async () => {
    const content = input.trim();
    const images = pendingImages.slice(0, MAX_IMAGES);
    if ((!content && images.length === 0) || sendingRef.current) return;
    if (listening) {
      setListening(false);
      stopRecording();
    }
    const hasModels = (settings?.ai.profiles?.length ?? 0) > 0 || Boolean(settings?.ai.hasKey || settings?.ai.local?.model);
    if (!hasModels) {
      setError("No models configured. Open Settings → AI and add one.");
      return;
    }
    setError(null);
    const snapshotContexts = [...contexts];
    setInput("");
    setContexts([]);
    setPendingImages([]);
    sounds.tick();
    const enqueue = useStore.getState().enqueueChatMessage;
    await enqueue(content, snapshotContexts, images.length ? images : undefined);
    void refreshTree();
    void refreshTasks();
  };

  const stop = async () => {
    const targets = messages.filter((m) => m.role === "assistant" && (m.status === "queued" || m.status === "streaming"));
    // Splice queued items out first; aborting the live run kicks the next
    // pending job, and by then there is nothing left to kick.
    for (const m of targets) {
      if (m.status === "queued") await useStore.getState().cancelChatJob(m.id);
    }
    for (const m of targets) {
      if (m.status === "streaming") void useStore.getState().cancelChatJob(m.id);
    }
    void refreshTree();
    void refreshTasks();
    inputRef.current?.focus();
  };

  const isStreamingMessage = (id: string) =>
    messages.find((m) => m.id === id)?.status === "streaming";

  const rewriteMessage = (msg: { id: string; content: string }, mode: TransformMode, lang?: string) => {
    if (rewriting || hasQueuedOrStreaming || !msg.content.trim()) return;
    const original = msg.content;
    void useStore.getState().persistMessageUndo(msg.id, original);
    const controller = new AbortController();
    setRewriting({ id: msg.id, abort: controller });
    let acc = "";
    streamTransform(
      mode,
      original,
      {
        onDelta: (d) => {
          acc += d;
          updateMessage(msg.id, acc);
        },
        onDone: () => {
          setRewriting(null);
          sounds.done();
          if (acc.trim() === original.trim()) {
            void useStore.getState().persistMessageUndo(msg.id, null);
          } else {
            void useStore.getState().persistMessages();
          }
        },
        onError: (message) => {
          setRewriting(null);
          setError(message);
          updateMessage(msg.id, original);
          void useStore.getState().persistMessageUndo(msg.id, null);
        },
      },
      { lang, signal: controller.signal },
    ).catch((e) => {
      setRewriting(null);
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        updateMessage(msg.id, original);
        void useStore.getState().persistMessageUndo(msg.id, null);
      }
    });
  };

  const undoRewrite = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    const prev = msg?.undoContent;
    if (!prev) return;
    updateMessage(msgId, prev);
    void useStore.getState().persistMessageUndo(msgId, null);
  };

  const saveEdit = async (msg: { id: string; content: string }) => {
    if (!editing || editing.id !== msg.id || sendingRef.current) return;
    const draft = editing.draft.trim();
    if (!draft || draft === msg.content.trim()) {
      setEditing(null);
      return;
    }
    sendingRef.current = true;
    setEditing(null);
    const ok = await useStore.getState().editChatMessage(msg.id, draft);
    sendingRef.current = false;
    if (!ok) setError("Could not edit that message — it may still be running.");
    inputRef.current?.focus();
  };

  const aiReady = (() => {
    const backend = settings?.ai.backend ?? "auto";
    if (backend === "local") return Boolean(settings?.ai.local?.model);
    if (backend === "cloud") return Boolean(settings?.ai.hasKey);
    return Boolean(settings?.ai.hasKey || settings?.ai.local?.model);
  })();

  return (
    <div className="h-full flex flex-col min-h-0 bg-stone-50 dark:bg-stone-900">
      <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="max-w-[560px] w-full">
              <EmptyState
                icon={Sparkles}
                title="What do you want Persona to work on?"
                subtitle={
                  <>
                    Ask about your workspace, or attach context with{" "}
                    <code className="font-mono text-[12px] bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-1.5 py-0.5">@file.md</code>{" "}
                    <code className="font-mono text-[12px] bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-1.5 py-0.5">@folder</code>{" "}
                    <code className="font-mono text-[12px] bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-1.5 py-0.5">@tasks</code>
                    <br />
                    Paste a screenshot to have it described or the text extracted.
                  </>
                }
                actionLabel="Ask AI…"
                onAction={() => inputRef.current?.focus()}
              >
                {(() => {
                  const backend = settings?.ai.backend ?? "auto";
                  if (backend === "cloud") return null;
                  if (!settings?.ai.local) {
                    if (backend !== "local") return null;
                    return (
                      <div className="inline-flex items-center gap-2 text-[11.5px] rounded-full pl-3 pr-4 py-1.5 shadow-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-amber-500" />
                        Ollama is not running — start it, or switch the chat backend in Settings.
                      </div>
                    );
                  }
                  if (backend !== "local" && settings?.ai.hasKey) return null;
                  return (
                    <div
                      className={`inline-flex items-center gap-2 text-[11.5px] rounded-full pl-3 pr-4 py-1.5 shadow-sm ${
                        settings.ai.local.model
                          ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900"
                          : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                          settings.ai.local.model ? "bg-emerald-500" : "bg-amber-500"
                        }`}
                      />
                      {settings.ai.local.model
                        ? `Connected to ${settings.ai.local.name} — ${settings.ai.local.model} (no API key needed)`
                        : "Ollama detected — no models installed. Pull one: `ollama pull llama3.2`"}
                    </div>
                  );
                })()}
                {aiReady && (
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {(
                      [
                        "What's in my workspace?",
                        "Summarize my open tasks",
                        "Plan my week",
                      ] as const
                    ).map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          setInput(prompt);
                          inputRef.current?.focus();
                        }}
                        className="px-3 py-1.5 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[12px] text-stone-600 dark:text-stone-400 hover:border-blue-300 dark:hover:border-blue-800 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </EmptyState>
            </div>
          </div>
        ) : (
          <div className="max-w-[680px] mx-auto px-6 py-8 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-1.5 msg-in">
                {msg.role === "user" ? (
                  <div className="flex justify-end items-center gap-1.5 group/msg">
                    {editing?.id === msg.id ? (
                      <div className="w-full max-w-[85%]">
                        <textarea
                          autoFocus
                          value={editing.draft}
                          rows={Math.min(8, Math.max(2, editing.draft.split("\n").length))}
                          onChange={(e) => setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              void saveEdit(msg);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-full rounded-2xl rounded-br-md border border-blue-300 dark:border-blue-800 bg-white dark:bg-stone-800 px-4 py-2.5 text-[13.5px] leading-relaxed outline-none resize-none shadow-sm"
                        />
                        <div className="mt-1 flex justify-end gap-1.5">
                          <button
                            onClick={() => setEditing(null)}
                            className="px-2.5 py-1 rounded-md text-[11.5px] text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => void saveEdit(msg)}
                            disabled={!editing.draft.trim()}
                            className="px-2.5 py-1 rounded-md text-[11.5px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            Save &amp; re-run
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {!hasQueuedOrStreaming && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditing({ id: msg.id, draft: msg.content })}
                              title="Edit & re-run"
                              className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => void useStore.getState().forkChatAt(msg.id)}
                              title="Fork conversation from here"
                              className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <GitFork className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        <div className="bubble-gradient max-w-[85%] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap shadow-sm shadow-blue-600/20">
                          {msg.content}
                          {msg.images && msg.images.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {msg.images.map((src, i) => (
                                <img
                                  key={i}
                                  src={src}
                                  alt={`Attached image ${i + 1}`}
                                  className="w-16 h-16 object-cover rounded-lg bg-white/20 ring-1 ring-white/30"
                                />
                              ))}
                            </div>
                          )}
                          {msg.contexts && msg.contexts.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {msg.contexts.map((c, i) => (
                                <span
                                  key={i}
                                  className="flex items-center gap-1 text-[11px] bg-white/20 rounded-full px-2 py-0.5"
                                >
                                  {contextIcon(c)}
                                  {c.type === "tasks" ? "Tasks" : c.path}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <div className="group max-w-[85%] min-w-0">
                      {!isStreamingMessage(msg.id) && msg.content && (
                        <div className="flex justify-end items-center gap-0.5 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {rewriting?.id === msg.id && (
                            <button
                              onClick={() => rewriting.abort.abort()}
                              title="Stop rewriting"
                              className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-red-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </button>
                          )}
                          {msg.undoContent && rewriting?.id !== msg.id && (
                            <button
                              onClick={() => undoRewrite(msg.id)}
                              title="Undo rewrite"
                              className="flex items-center gap-1 p-1 rounded-md text-[11px] text-stone-500 dark:text-stone-400 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <Undo2 className="w-3 h-3" />
                              Undo
                            </button>
                          )}
                          {rewriting?.id !== msg.id && (
                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  title="Rewrite with AI"
                                  className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  align="end"
                                  sideOffset={4}
                                  className="min-w-[170px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                                >
                                  {(
                                    [
                                      { mode: "explain", label: "Explain", icon: TextQuote },
                                      { mode: "shorten", label: "Shorten", icon: MessageCircle },
                                      { mode: "rewrite", label: "Rephrase", icon: Sparkles },
                                    ] as const
                                  ).map((a) => (
                                    <DropdownMenu.Item
                                      key={a.mode}
                                      onSelect={() => rewriteMessage(msg, a.mode)}
                                      className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center gap-2"
                                    >
                                      <a.icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                                      {a.label}
                                    </DropdownMenu.Item>
                                  ))}
                                  <DropdownMenu.Sub>
                                    <DropdownMenu.SubTrigger className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center justify-between">
                                      <span className="flex items-center gap-2">
                                        <MessageCircle className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                                        Tone…
                                      </span>
                                    </DropdownMenu.SubTrigger>
                                    <DropdownMenu.Portal>
                                      <DropdownMenu.SubContent
                                        sideOffset={4}
                                        className="min-w-[140px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                                      >
                                        {["friendly", "professional", "concise", "casual", "formal"].map((tone) => (
                                          <DropdownMenu.Item
                                            key={tone}
                                            onSelect={() => rewriteMessage(msg, "tone", tone)}
                                            className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                                          >
                                            {tone}
                                          </DropdownMenu.Item>
                                        ))}
                                      </DropdownMenu.SubContent>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Sub>
                                  <DropdownMenu.Sub>
                                    <DropdownMenu.SubTrigger className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center justify-between">
                                      <span className="flex items-center gap-2">
                                        <Languages className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                                        Translate…
                                      </span>
                                    </DropdownMenu.SubTrigger>
                                    <DropdownMenu.Portal>
                                      <DropdownMenu.SubContent
                                        sideOffset={4}
                                        className="min-w-[140px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px] max-h-56 overflow-y-auto"
                                      >
                                        {["Spanish", "French", "German", "Italian", "Japanese", "Chinese", "Portuguese", "English"].map((l) => (
                                          <DropdownMenu.Item
                                            key={l}
                                            onSelect={() => rewriteMessage(msg, "translate", l)}
                                            className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                                          >
                                            {l}
                                          </DropdownMenu.Item>
                                        ))}
                                      </DropdownMenu.SubContent>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Sub>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          )}
                          {(msg.status === "done" || msg.status === "cancelled") && !hasQueuedOrStreaming && rewriting?.id !== msg.id && (
                            <button
                              onClick={() => void useStore.getState().retryChatJob(msg.id)}
                              title="Regenerate this response"
                              className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!hasQueuedOrStreaming && (
                            <button
                              onClick={() => void useStore.getState().forkChatAt(msg.id)}
                              title="Fork conversation from here"
                              className="p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                            >
                              <GitFork className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <CopyButton text={msg.content} />
                        </div>
                      )}
                      <div className="md-body chat-md text-[13.5px] leading-relaxed text-stone-700 dark:text-stone-300">
                        {msg.content ? (
                          <Markdown content={msg.content} />
                        ) : (
                          <span className="text-stone-400 dark:text-stone-500 italic">…</span>
                        )}
                        {isStreamingMessage(msg.id) && <span className="chat-caret" />}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {msg.sources.map((s, i) => (
                              <button
                                key={i}
                                onClick={() => openDocAtLine(s.path, s.line)}
                                title={`Open ${s.path} at line ${s.line}`}
                                className="flex items-center gap-1.5 text-[11px] rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-2 py-0.5 text-stone-500 dark:text-stone-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
                              >
                                <FileText className="w-3 h-3" />
                                <span className="font-mono">
                                  source: {s.path}:{s.line}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {msg.steps && msg.steps.length > 0 && isStreamingMessage(msg.id) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {msg.steps.map((c, i) => (
                              <span
                                key={i}
                                title={c.detail}
                                className={`flex items-center gap-1.5 text-[11px] rounded-full border px-2 py-0.5 ${
                                  c.status === "done"
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                                    : "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"
                                }`}
                              >
                                {c.status === "done" ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                )}
                                {toolLabel(c.name)}
                              </span>
                            ))}
                          </div>
                        )}
                        {msg.pendingApproval && (
                          <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3">
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-200">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Persona wants to {toolLabel(msg.pendingApproval.tool)} — approve?
                            </div>
                            <div className="mt-1.5 font-mono text-[11px] text-stone-600 dark:text-stone-400 break-all">
                              {Object.entries(msg.pendingApproval.args)
                                .map(([k, v]) => `${k}="${String(v).slice(0, 200)}"`)
                                .join("  ") || "(no arguments)"}
                            </div>
                            <div className="mt-2.5 flex gap-2">
                              <button
                                onClick={() => void api.resolveChatApproval(currentChatId!, msg.pendingApproval!.id, true)}
                                className="px-3 py-1 rounded-md bg-amber-600 text-white text-[11.5px] font-medium hover:bg-amber-700 transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => void api.resolveChatApproval(currentChatId!, msg.pendingApproval!.id, false)}
                                className="px-3 py-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-[11.5px] hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors"
                              >
                                Deny
                              </button>
                            </div>
                          </div>
                        )}
                        {msg.status === "queued" && (
                          <div className="mt-1 text-[11px] text-stone-400">Queued — will run after the current job.</div>
                        )}
                        {msg.status === "failed" && msg.error && (
                          <div className="mt-2 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                            <span>{msg.error}</span>
                            <button
                              onClick={() =>
                                void (failedEnqueues[msg.id]
                                  ? useStore.getState().resendFailedChat(msg.id)
                                  : useStore.getState().retryChatJob(msg.id))
                              }
                              className="px-2 py-1 rounded bg-white border text-stone-700"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {error && !hasQueuedOrStreaming && (
              <div className="text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}
            {hasQueuedOrStreaming && (
              <div className="text-[11px] text-stone-500">Running in background — you can queue more messages or close this chat.</div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 pb-4 pt-2 px-4">
        <div className="max-w-[760px] mx-auto">
          <div className="mb-2 flex items-center gap-1.5">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  title="Persona — how the assistant should behave"
                  className="flex items-center gap-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-2 py-1 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:border-stone-300 dark:hover:border-stone-600 transition-colors"
                >
                  <PenLine className="w-3 h-3" />
                  {activePersonaName}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={4}
                  className="min-w-[170px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                >
                  {personas.map((p) => (
                    <DropdownMenu.Item
                      key={p.id}
                      onSelect={() => void setChatSettings({ personaId: p.id })}
                      title={p.prompt || undefined}
                      className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center justify-between gap-3"
                    >
                      <span>
                        {p.name}
                        {!p.builtin && <span className="ml-1.5 text-[10px] text-stone-400">custom</span>}
                      </span>
                      {(chatSettings.personaId ?? "default") === p.id && (
                        <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      )}
                    </DropdownMenu.Item>
                  ))}
                  <div className="px-2.5 py-1 text-[10px] text-stone-400 border-t border-stone-100 dark:border-stone-700 mt-1">
                    Add your own in .persona/personas/
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  title="Model for this conversation"
                  className="flex items-center gap-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-2 py-1 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:border-stone-300 dark:hover:border-stone-600 transition-colors"
                >
                  <Cpu className="w-3 h-3" />
                  {activeModelLabel}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={4}
                  className="min-w-[180px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px] max-h-64 overflow-y-auto"
                >
                  <button
                    onClick={() => void setChatSettings({ modelId: null })}
                    className={`w-full px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-left flex items-center justify-between gap-3 ${
                      !chatSettings.modelId
                        ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40"
                        : "text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
                    }`}
                  >
                    Auto (global default)
                    {!chatSettings.modelId && <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                  </button>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => void setChatSettings({ modelId: p.id })}
                      className={`w-full px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-left flex items-center justify-between gap-3 ${
                        chatSettings.modelId === p.id
                          ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40"
                          : "text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60"
                      }`}
                    >
                      <span className="truncate">{p.label}</span>
                      {chatSettings.modelId === p.id && <Check className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />}
                    </button>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  title="Temperature for this conversation"
                  className="flex items-center gap-1.5 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-2 py-1 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:border-stone-300 dark:hover:border-stone-600 transition-colors"
                >
                  <Thermometer className="w-3 h-3" />
                  Temp · {activeTemp?.label ?? "Auto"}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={4}
                  className="min-w-[140px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                >
                  {tempPresets.map((t) => {
                    const active = t.value === null ? chatSettings.temperature == null : t.value === chatSettings.temperature;
                    return (
                      <DropdownMenu.Item
                        key={t.label}
                        onSelect={() => void setChatSettings({ temperature: t.value })}
                        className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60 flex items-center justify-between gap-3"
                      >
                        {t.label}
                        {active && <Check className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                      </DropdownMenu.Item>
                    );
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <div className="flex-1" />
          </div>

          {contexts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {contexts.map((c, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 text-[11.5px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-full pl-2 pr-1 py-0.5 text-stone-600 dark:text-stone-400 shadow-sm"
                >
                  {c.type === "tasks" ? (
                    <SquareCheck className="w-3 h-3" />
                  ) : c.type === "folder" ? (
                    <Folder className="w-3 h-3" />
                  ) : (
                    <FileText className="w-3 h-3" />
                  )}
                  {c.type === "tasks" ? "Tasks" : c.path}
                  <button
                    onClick={() => setContexts((prev) => prev.filter((_, j) => j !== i))}
                    className="p-0.5 rounded-full hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files ?? []);
              for (const file of files) {
                if (!file.type.startsWith("image/")) continue;
                try {
                  const dataUrl = await readImageFile(file);
                  setPendingImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl]));
                } catch {
                  // ignore unreadable
                }
              }
            }}
            className={`focus-aura rounded-2xl border bg-white dark:bg-stone-800 shadow-sm transition-shadow focus-within:shadow-md focus-within:shadow-stone-900/5 ${
              dragOver ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800" : "border-stone-200 dark:border-stone-700"
            }`}
          >
            <div className="relative">
              {mentionQuery !== null && suggestions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 max-h-56 overflow-y-auto z-10">
                  {suggestions.map((item, i) => {
                    const Icon = itemIcon(item);
                    return (
                      <button
                        key={`${item.type}:${item.path}`}
                        onMouseEnter={() => setSuggestionIndex(i)}
                        onClick={() => selectSuggestion(item)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left text-[13px] ${
                          i === suggestionIndex
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                            : "text-stone-700 dark:text-stone-300"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {pendingImages.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-2.5">
                  {pendingImages.map((src, i) => (
                    <div key={i} className="relative group/img">
                      <img
                        src={src}
                        alt={`Attached image ${i + 1}`}
                        className="w-12 h-12 object-cover rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900"
                      />
                      <button
                        onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                        title="Remove image"
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-700 text-white shadow-sm hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => onInputChange(e.target.value)}
                onPaste={(e) => void onPaste(e)}
                onKeyDown={(e) => {
                  if (mentionQuery !== null && suggestions.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSuggestionIndex((i) => (i + 1) % suggestions.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSuggestionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      selectSuggestion(suggestions[suggestionIndex]!);
                      return;
                    }
                    if (e.key === "Escape") {
                      setMentionQuery(null);
                      setSuggestions([]);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  hasQueuedOrStreaming
                    ? "Queued — add another message…"
                    : transcribing
                      ? "Transcribing your voice…"
                      : listening
                        ? "Listening… tap the mic to stop"
                        : "Ask Persona anything…  (@file, @folder, @tasks)  · paste a screenshot to describe or read it  · tap the mic to dictate"
                }
                className="w-full px-4 py-3 text-[13.5px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-none bg-transparent overflow-y-auto"
              />
            </div>

            <div className="flex items-center px-3 py-1.5 border-t border-stone-100 dark:border-stone-700/60">
              <span className="text-[10.5px] text-stone-300 dark:text-stone-600 select-none">
                Enter to send · Shift+Enter for newline
              </span>
              <div className="flex-1" />
              <label
                title="Attach image"
                className={`p-1.5 rounded-md cursor-pointer text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => void onPickFiles(e)}
                />
                <ImagePlus className="w-4 h-4" />
              </label>
              <button
                onClick={() => void toggleMic()}
                className={`p-1.5 rounded-md transition-colors ${
                  listening
                    ? "text-red-600 bg-red-50 dark:bg-red-950/40"
                    : transcribing
                      ? "text-stone-400 dark:text-stone-500 cursor-default"
                      : "text-stone-400 dark:text-stone-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                }`}
                title={
                  transcribing
                    ? "Transcribing…"
                    : listening
                      ? "Stop recording"
                      : "Record voice (local speech-to-text)"
                }
              >
                {transcribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mic className={`w-4 h-4 ${listening ? "animate-pulse" : ""}`} />
                )}
              </button>
              <button
                onClick={hasQueuedOrStreaming ? () => void stop() : () => void send()}
                disabled={!hasQueuedOrStreaming && !input.trim() && pendingImages.length === 0}
                className={`p-1.5 rounded-md disabled:opacity-40 disabled:cursor-default ${
                  hasQueuedOrStreaming
                    ? "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:bg-stone-700/40 dark:hover:bg-stone-700/40"
                    : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                }`}
                title={hasQueuedOrStreaming ? "Stop" : "Send"}
              >
                {hasQueuedOrStreaming ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>

          {messages.length > 0 && !hasQueuedOrStreaming && (
            <div className="mt-2 flex justify-end gap-3">
              <button
                onClick={() => {
                  const id = useStore.getState().currentChatId;
                  if (id) void api.exportChat(id).catch((e) => setError((e as Error).message));
                }}
                className="flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500 hover:text-stone-700"
              >
                <FolderOpen className="w-3 h-3" /> Export
              </button>
              <button
                onClick={() => {
                  if (confirm("Clear this conversation? It will be removed from your chat history.")) {
                    const id = useStore.getState().currentChatId;
                    if (id) void api.deleteChat(id).catch(() => {});
                    startNewChat();
                    setError(null);
                    void refreshChats();
                  }
                }}
                className="flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500 hover:text-stone-700"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function contextIcon(c: ContextTarget) {
  if (c.type === "tasks") return <SquareCheck className="w-3 h-3" />;
  if (c.type === "folder") return <Folder className="w-3 h-3" />;
  return <FileText className="w-3 h-3" />;
}
