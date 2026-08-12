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
} from "lucide-react";
import { useStore } from "../state/store";
import { api, streamChat, streamTransform } from "../lib/api";
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
  const streaming = useStore((s) => s.streaming);
  const currentChatId = useStore((s) => s.currentChatId);
  const pushMessage = useStore((s) => s.pushMessage);
  const updateLastMessage = useStore((s) => s.updateLastMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const popLastMessage = useStore((s) => s.popLastMessage);
  const setStreaming = useStore((s) => s.setStreaming);
  const setCurrentChatId = useStore((s) => s.setCurrentChatId);
  const startNewChat = useStore((s) => s.startNewChat);
  const refreshChats = useStore((s) => s.refreshChats);
  const attachMessageSources = useStore((s) => s.attachMessageSources);
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
  const [toolChips, setToolChips] = useState<{ name: string; done: boolean; detail?: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [rewriting, setRewriting] = useState<{ id: string; abort: AbortController } | null>(null);
  const [rewriteUndo, setRewriteUndo] = useState<Record<string, string>>({});

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const idRef = useRef(0);
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

  const nextId = (role: "u" | "a") => `${role}${Date.now()}-${idRef.current++}`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Persist the conversation as a structured transcript (debounced).
  useEffect(() => {
    if (messages.length === 0) return;
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
  }, [messages, setCurrentChatId]);

  useEffect(() => {
    if (scrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

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
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      // Flush the pending transcript so the latest messages are never lost.
      const store = useStore.getState();
      const msgs = store.messages;
      if (msgs.length > 0 && !store.streaming) {
        const firstUser = msgs.find((m) => m.role === "user")?.content ?? "";
        const title = firstUser.replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled chat";
        let id = store.currentChatId;
        if (!id) {
          id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          store.setCurrentChatId(id);
        }
        void api.saveChat(id, title, msgs).catch(() => {});
      }
    };
  }, [setStreaming]);

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
    if (transcribing || streaming || micBusyRef.current) return;
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
    if ((!content && images.length === 0) || streaming || sendingRef.current) return;
    if (listening) {
      setListening(false);
      stopRecording();
    }
    const backend = settings?.ai.backend ?? "auto";
    if (backend === "local") {
      if (!settings?.ai.local?.model) {
        setError(
          settings?.ai.local
            ? "Ollama is running but has no models installed. Pull one first: `ollama pull llama3.2`."
            : "Ollama is not running. Start it, or switch the chat backend in Settings (⌘,).",
        );
        return;
      }
    } else if (backend === "cloud") {
      if (!settings?.ai.hasKey) {
        setError("No API key configured. Open Settings (⌘,) and add one.");
        return;
      }
    } else if (!settings?.ai.hasKey && !settings?.ai.local?.model) {
      setError(
        settings?.ai.local
          ? "Ollama is running but has no models installed. Pull one first: `ollama pull llama3.2`."
          : "No API key configured. Open Settings (⌘,) and add one.",
      );
      return;
    }
    setError(null);
    setInput("");
    setContexts([]);
    setToolChips([]);
    setPendingImages([]);
    sounds.tick();
    const userMsg = {
      id: nextId("u"),
      role: "user" as const,
      content,
      contexts: contexts.length ? [...contexts] : undefined,
      images: images.length ? images : undefined,
      createdAt: Date.now(),
    };
    const assistantId = nextId("a");
    pushMessage(userMsg);
    pushMessage({ id: assistantId, role: "assistant", content: "", createdAt: Date.now() });
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    sendingRef.current = true;
    // The conversation can be swapped underneath this stream (New Chat /
    // continue old chat while streaming). Once the assistant bubble this
    // turn created is gone, the response is dead — abort it instead of
    // appending into a different conversation.
    const stillActive = () => useStore.getState().messages.some((m) => m.id === assistantId);
    const abortIfStale = () => {
      if (!stillActive()) {
        controller.abort();
        return true;
      }
      return false;
    };
    const seen = new Set<string>();
    // Attachments stay attached for the last few turns, then drop off so
    // stale context never bloats the request. The model can always re-read
    // files with its tools.
    const allContexts = [...messages, userMsg]
      .slice(-6)
      .flatMap((m) => m.contexts ?? [])
      .filter((c) => {
        const key = `${c.type}:${c.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    try {
      await streamChat(
        [...messages, userMsg],
        allContexts,
        {
          onDelta: (delta) => {
            if (abortIfStale()) return;
            updateLastMessage((last) => last + delta);
          },
          onDone: () => {
            if (abortIfStale()) return;
            setStreaming(false);
            abortRef.current = null;
            sendingRef.current = false;
            sounds.done();
            void refreshTree();
            void refreshTasks();
            inputRef.current?.focus();
          },
          onError: (message) => {
            if (abortIfStale()) return;
            setStreaming(false);
            abortRef.current = null;
            sendingRef.current = false;
            setError(message);
            const last = useStore.getState().messages[useStore.getState().messages.length - 1];
            if (last && last.role === "assistant" && !last.content) {
              popLastMessage();
            } else {
              updateLastMessage((prev) => prev || message);
            }
            inputRef.current?.focus();
          },
          onTool: (name, status, detail) => {
            if (abortIfStale()) return;
            setToolChips((prev) => {
              if (status === "start") return [...prev, { name, done: false }];
              const reverseIdx = [...prev].reverse().findIndex((c) => c.name === name && !c.done);
              if (reverseIdx === -1) return [...prev, { name, done: true, detail }];
              const next = [...prev];
              next[prev.length - 1 - reverseIdx] = { name, done: true, detail };
              return next;
            });
          },
          onCitations: (sources) => {
            if (abortIfStale()) return;
            attachMessageSources(sources);
          },
        },
        controller.signal,
      );
    } catch (e) {
      setStreaming(false);
      abortRef.current = null;
      sendingRef.current = false;
      if ((e as Error).name !== "AbortError" && stillActive()) {
        setError((e as Error).message);
        const last = useStore.getState().messages[useStore.getState().messages.length - 1];
        if (last && last.role === "assistant" && !last.content) {
          popLastMessage();
        }
      }
      inputRef.current?.focus();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    sendingRef.current = false;
    setStreaming(false);
    void refreshTree();
    void refreshTasks();
    inputRef.current?.focus();
  };

  const isStreamingMessage = (id: string) =>
    streaming && messages[messages.length - 1]?.id === id;

  const rewriteMessage = (msg: { id: string; content: string }, mode: TransformMode, lang?: string) => {
    if (rewriting || streaming || !msg.content.trim()) return;
    const original = msg.content;
    setRewriteUndo((prev) => ({ ...prev, [msg.id]: original }));
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
            setRewriteUndo((prev) => {
              const next = { ...prev };
              delete next[msg.id];
              return next;
            });
          }
        },
        onError: (message) => {
          setRewriting(null);
          setError(message);
          updateMessage(msg.id, original);
          setRewriteUndo((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        },
      },
      { lang, signal: controller.signal },
    ).catch((e) => {
      setRewriting(null);
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        updateMessage(msg.id, original);
      }
    });
  };

  const undoRewrite = (msgId: string) => {
    const prev = rewriteUndo[msgId];
    if (prev === undefined) return;
    updateMessage(msgId, prev);
    setRewriteUndo((prevMap) => {
      const next = { ...prevMap };
      delete next[msgId];
      return next;
    });
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
                  <div className="flex justify-end">
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
                          {rewriteUndo[msg.id] !== undefined && rewriting?.id !== msg.id && (
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
                        {toolChips.length > 0 && isStreamingMessage(msg.id) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {toolChips.map((c, i) => (
                              <span
                                key={i}
                                title={c.detail}
                                className={`flex items-center gap-1.5 text-[11px] rounded-full border px-2 py-0.5 ${
                                  c.done
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                                    : "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"
                                }`}
                              >
                                {c.done ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                )}
                                {toolLabel(c.name)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {error && !streaming && (
              <div className="text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 pb-4 pt-2 px-4">
        <div className="max-w-[760px] mx-auto">
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

          <div className="focus-aura rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-sm transition-shadow focus-within:shadow-md focus-within:shadow-stone-900/5">
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
                  streaming
                    ? "Persona is thinking…"
                    : transcribing
                      ? "Transcribing your voice…"
                      : listening
                        ? "Listening… tap the mic to stop"
                        : "Ask Persona anything…  (@file, @folder, @tasks)  · paste a screenshot to describe or read it  · tap the mic to dictate"
                }
                disabled={streaming}
                className="w-full px-4 py-3 text-[13.5px] outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-none bg-transparent disabled:opacity-60 overflow-y-auto"
              />
            </div>

            <div className="flex items-center px-3 py-1.5 border-t border-stone-100 dark:border-stone-700/60">
              <span className="text-[10.5px] text-stone-300 dark:text-stone-600 select-none">
                Enter to send · Shift+Enter for newline
              </span>
              <div className="flex-1" />
              <label
                title="Attach image"
                className={`p-1.5 rounded-md cursor-pointer ${
                  streaming
                    ? "opacity-40 pointer-events-none"
                    : "text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                }`}
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
                disabled={streaming}
                className={`p-1.5 rounded-md disabled:opacity-40 disabled:cursor-default transition-colors ${
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
                onClick={streaming ? stop : () => void send()}
                disabled={!streaming && !input.trim() && pendingImages.length === 0}
                className={`p-1.5 rounded-md disabled:opacity-40 disabled:cursor-default ${
                  streaming
                    ? "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:bg-stone-700/40 dark:hover:bg-stone-700/40"
                    : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                }`}
                title={streaming ? "Stop" : "Send"}
              >
                {streaming ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Send className="w-4 h-4" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>

          {messages.length > 0 && !streaming && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => {
                  if (confirm("Clear this conversation? It will be removed from your chat history.")) {
                    const id = useStore.getState().currentChatId;
                    if (id) void api.deleteChat(id).catch(() => {});
                    startNewChat();
                    setError(null);
                    setToolChips([]);
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
