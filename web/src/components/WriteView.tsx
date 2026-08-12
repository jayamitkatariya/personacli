import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  RefreshCw,
  ArrowLeftRight,
  PenLine,
  Eye,
  Columns2,
  Ellipsis,
  RotateCcw,
  ListTree,
  Sparkles,
  X,
  Download,
  FileDown,
} from "lucide-react";
import { useStore, type OpenDoc } from "../state/store";
import { api } from "../lib/api";
import { sounds } from "../lib/sounds";
import EditorPane from "./EditorPane";
import MarkdownPreview from "./MarkdownPreview";
import TabBar from "./TabBar";
import FileViewer from "./FileViewer";
import EmptyState from "./EmptyState";
import Breadcrumbs from "./Breadcrumbs";

type ViewMode = "edit" | "preview" | "split";

export default function WriteView() {
  const docs = useStore((s) => s.docs);
  const activeDocPath = useStore((s) => s.activeDocPath);
  const doc = docs.find((d) => d.path === activeDocPath) ?? null;
  const setActiveDoc = useStore((s) => s.setActiveDoc);
  const closeDoc = useStore((s) => s.closeDoc);
  const reloadDoc = useStore((s) => s.reloadDoc);
  const refreshTree = useStore((s) => s.refreshTree);
  const createDraft = useStore((s) => s.createDraft);
  const docTags = useStore((s) => s.docTags);
  const clearDocTags = useStore((s) => s.clearDocTags);
  const [mode, setMode] = useState<ViewMode>("preview");

  const isText = doc?.kind === "text";

  const newDraft = () => {
    sounds.pop();
    void createDraft().catch((e) => alert((e as Error).message));
  };

  // external file changes: reload clean docs, flag dirty ones
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.tree === prev.tree) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const store = useStore.getState();
        for (const current of store.docs) {
          if (current.kind !== "text") continue;
          if (current.status === "saving") continue;
          void api
            .readFile(current.path)
            .then(({ content }) => {
              if (content === current.savedContent) return;
              const fresh = useStore.getState().docs.find((d) => d.path === current.path);
              if (!fresh) return;
              if (content === fresh.content) return;
              if (fresh.status === "saved") {
                useStore.getState().applyExternalContent(current.path, content);
              } else if (fresh.status !== "conflict") {
                useStore.getState().markDocConflict(current.path);
              }
            })
            .catch(() => {
              // file no longer exists on disk — close the stale tab
              const fresh = useStore.getState().docs.find((d) => d.path === current.path);
              if (fresh) useStore.getState().closeDoc(current.path);
            });
        }
      }, 300);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="h-full flex min-h-0 flex-col bg-stone-50 dark:bg-stone-900">
      <WriteHeader
        docs={docs}
        activePath={activeDocPath}
        doc={doc}
        mode={mode}
        setMode={setMode}
        onSelectTab={setActiveDoc}
        onCloseTab={closeDoc}
      />

      {doc && doc.kind === "text" && <Breadcrumbs path={doc.path} />}

      {doc ? (
        <>
          {doc.status === "conflict" && isText && (
            <div className="h-9 shrink-0 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center gap-3 px-3 text-[12px]">
              <span className="flex-1">This file changed on disk.</span>
              <button
                onClick={() => void reloadDoc(doc.path)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-900/80 font-medium"
              >
                <RotateCcw className="w-3 h-3" /> Reload
              </button>
              <button
                onClick={() => {
                  const store = useStore.getState();
                  const d = store.docs.find((x) => x.path === doc.path);
                  if (!d) return;
                  void api.saveFile(d.path, d.content).then(() =>
                    store.markDocSaved(d.path, d.content),
                  );
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-900/80 font-medium"
              >
                Overwrite
              </button>
            </div>
          )}

          {isText && docTags[doc.path] && (
            <div className="h-8 shrink-0 border-b border-stone-200 dark:border-stone-700/80 bg-blue-50/60 dark:bg-blue-950/30 flex items-center gap-1.5 px-3 text-[11.5px]">
              <Sparkles className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="text-stone-500 dark:text-stone-400 shrink-0">AI tags:</span>
              {docTags[doc.path]?.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-px rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium"
                >
                  #{t}
                </span>
              ))}
              <span className="flex-1" />
              <button
                onClick={() => clearDocTags(doc.path)}
                title="Dismiss"
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 flex bg-white dark:bg-stone-800">
            {isText ? (
              <>
                {(mode === "edit" || mode === "split") && (
                  <div className={mode === "split" ? "w-1/2 border-r border-stone-200 dark:border-stone-700/80 dark:border-stone-800" : "flex-1 min-w-0"}>
                    <div className="h-full relative">
                      {docs.map((d) => (
                        <div
                          key={d.path}
                          className={`absolute inset-0 ${d.path === activeDocPath ? "" : "hidden"}`}
                        >
                          <EditorPane docPath={d.path} content={d.content} status={d.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(mode === "preview" || mode === "split") && (
                  <div className={mode === "split" ? "w-1/2" : "flex-1 min-w-0"}>
                    <MarkdownPreview content={doc.content} path={doc.path} />
                  </div>
                )}
              </>
            ) : (
              <FileViewer key={doc.path} path={doc.path} kind={doc.kind as "pdf" | "html" | "image"} />
            )}
          </div>
        </>
      ) : (
        <WriteEmptyState
          onNewDraft={newDraft}
          onRefresh={() => void refreshTree()}
          onSwitchWorkspace={() => useStore.getState().openPalette("search")}
        />
      )}
    </div>
  );
}

function WriteHeader({
  docs,
  activePath,
  doc,
  mode,
  setMode,
  onSelectTab,
  onCloseTab,
}: {
  docs: OpenDoc[];
  activePath: string | null;
  doc: OpenDoc | null;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}) {
  const closeDoc = useStore((s) => s.closeDoc);
  const refreshTree = useStore((s) => s.refreshTree);
  const tagBusy = useStore((s) => s.tagBusy);
  const suggestAndApplyTags = useStore((s) => s.suggestAndApplyTags);
  const settings = useStore((s) => s.settings);
  const hasAi = Boolean(settings?.ai.hasKey || settings?.ai.local);

  const exportDoc = (format: "pdf" | "docx") => {
    if (!doc) return;
    const current = docs.find((d) => d.path === doc.path);
    void api
      .exportNote(doc.path, format, current?.content ?? undefined)
      .catch((e) => alert((e as Error).message));
  };

  const subtitle = doc
    ? doc.kind !== "text"
      ? "Viewing"
      : doc.status === "saved"
        ? "Saved"
        : doc.status === "saving"
          ? "Saving…"
          : doc.status === "conflict"
            ? "Changed on disk"
            : "Unsaved changes"
    : "No file open";

  return (
    <div className="h-11 shrink-0 border-b border-stone-200 dark:border-stone-700/80 bg-white dark:bg-stone-800 flex items-center px-3 gap-3">
      <div className="flex items-baseline gap-2 shrink-0">
        <h1 className="text-[14px] font-semibold text-stone-900 dark:text-stone-100">Write</h1>
        <span className="text-[11.5px] text-stone-400 dark:text-stone-500">{subtitle}</span>
      </div>

      <TabBar docs={docs} activePath={activePath} onSelect={onSelectTab} onClose={onCloseTab} />

      {doc && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 text-[11.5px] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-stone-700/40 dark:hover:bg-stone-700/60 shrink-0">
              <ListTree className="w-3 h-3" />
              <span className="truncate max-w-[160px]">{doc.path.split("/").pop()}</span>
              <Ellipsis className="w-3 h-3 text-stone-400 dark:text-stone-500" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="min-w-[160px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
            >
              <DropdownMenu.Item
                onSelect={() => {
                  void api.duplicateEntry(doc.path).then(() => refreshTree());
                }}
                className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
              >
                Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  if (confirm(`Delete "${doc.path}"?`)) {
                    void api.deleteEntry(doc.path).then(() => {
                      closeDoc(doc.path);
                      void refreshTree();
                    });
                  }
                }}
                className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-red-600 hover:bg-red-50 focus:bg-red-50"
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      {doc && doc.kind === "text" && (
        <div className="flex items-center gap-1.5 shrink-0">
          {hasAi && (
            <button
              title={tagBusy ? "Suggesting tags…" : "Suggest AI tags"}
              disabled={tagBusy}
              onClick={() => void suggestAndApplyTags(doc.path)}
              className={`p-1.5 rounded-md ${
                tagBusy
                  ? "text-blue-500 animate-pulse cursor-default"
                  : "text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                title="Export"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={2} />
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
                    onSelect={() => exportDoc(item.format)}
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
          <div className="flex items-center border border-stone-200 dark:border-stone-700 rounded-md overflow-hidden">
            {(
              [
                { key: "edit", icon: PenLine, title: "Edit" },
                { key: "split", icon: Columns2, title: "Split" },
                { key: "preview", icon: Eye, title: "Preview" },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                title={m.title}
                onClick={() => setMode(m.key)}
                className={`p-1.5 ${
                  mode === m.key
                    ? "bg-stone-100 dark:bg-stone-700/60 text-stone-800 dark:text-stone-200"
                    : "text-stone-400 dark:text-stone-500 hover:text-stone-700"
                }`}
              >
                <m.icon className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WriteEmptyState({
  onNewDraft,
  onRefresh,
  onSwitchWorkspace,
}: {
  onNewDraft: () => void;
  onRefresh: () => void;
  onSwitchWorkspace: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const workspaceName = settings?.workspace?.split("/").filter(Boolean).pop() ?? "workspace";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[560px] mx-auto pt-10 px-8">
        <EmptyState
          icon={PenLine}
          title="Start with a new draft."
          subtitle="Pick a file from the sidebar, or create a new note to start writing."
          actionLabel="New note"
          onAction={onNewDraft}
        >
          <div className="space-y-2">
            <button
              onClick={onRefresh}
              className="w-full flex items-start gap-3 px-4 py-3 rounded-xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-left hover:border-stone-300 dark:border-stone-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-stone-800 dark:text-stone-200">Refresh files</div>
                <div className="text-[11.5px] text-stone-500 dark:text-stone-400 mt-0.5">Rescan and update the file tree</div>
              </div>
            </button>

            <button
              onClick={onSwitchWorkspace}
              className="w-full flex items-start gap-3 px-4 py-3 rounded-xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-left hover:border-stone-300 dark:border-stone-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                <ArrowLeftRight className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-stone-800 dark:text-stone-200">Switch workspace</div>
                <div className="text-[11.5px] text-stone-500 dark:text-stone-400 mt-0.5">Search and jump to any file</div>
              </div>
            </button>

            <div className="mt-3 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700/80 p-4">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
                Current workspace
              </div>
              <div className="mt-1.5 text-[13.5px] font-medium text-stone-800 dark:text-stone-200">{workspaceName}</div>
            </div>

            <div className="mt-3 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700/80 p-4">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium mb-2">
                Shortcuts
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["⌘N", "New file"],
                    ["⌘T", "Draft"],
                    ["⌘K", "Commands"],
                    ["⌘P", "Search"],
                  ] as const
                ).map(([key, label]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white dark:bg-stone-900/60 border border-stone-200 dark:border-stone-700/80 text-[11px] text-stone-500 dark:text-stone-400"
                  >
                    <kbd className="font-semibold text-stone-700 dark:text-stone-200">{key}</kbd>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </EmptyState>
      </div>
    </div>
  );
}
