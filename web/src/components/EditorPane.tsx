import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Decoration, DecorationSet, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { Loader2, Sparkles, Square, Languages } from "lucide-react";
import { useStore, type SaveStatus } from "../state/store";
import { api, streamTransform } from "../lib/api";
import { sounds } from "../lib/sounds";
import { personaTheme, highlightExtensions } from "../lib/cmTheme";
import { cmAiExtension, rangeTracker, paragraphRange } from "../lib/cmAi";
import type { TransformMode } from "../../../src/shared/types";

const highlightLine = StateEffect.define<{ from: number; to: number }>();
const clearHighlight = StateEffect.define<null>();

// transient line highlight for chat citation jumps; dropped on any edit
const citationHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    if (tr.docChanged) return Decoration.none;
    for (const e of tr.effects) {
      if (e.is(highlightLine)) {
        return Decoration.set([
          Decoration.mark({ class: "cm-cite-highlight" }).range(e.value.from, e.value.to),
        ]);
      }
      if (e.is(clearHighlight)) return Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const EDITOR_ACTIONS: { mode: TransformMode; label: string }[] = [
  { mode: "summarize", label: "Summarize" },
  { mode: "fix_grammar", label: "Fix grammar" },
  { mode: "rewrite", label: "Rewrite" },
  { mode: "bulletize", label: "Bulletize" },
];

const LANGUAGES = [
  "Spanish",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Chinese",
  "Portuguese",
  "English",
];

const MODE_LABEL: Record<TransformMode, string> = {
  summarize: "Summarizing",
  fix_grammar: "Fixing grammar",
  rewrite: "Rewriting",
  translate: "Translating",
  bulletize: "Bulletizing",
  explain: "Explaining",
  shorten: "Shortening",
  tone: "Adjusting tone",
};

interface Point {
  left: number;
  top: number;
}

export default function EditorPane({
  docPath,
  content,
  status,
}: {
  docPath: string;
  content: string;
  status: SaveStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const setDocContent = useStore((s) => s.setDocContent);
  const pendingLineJump = useStore((s) => s.pendingLineJump);
  const clearLineJump = useStore((s) => s.clearLineJump);

  const [bubble, setBubble] = useState<{ from: number; to: number } | null>(null);
  const [bubblePos, setBubblePos] = useState<Point | null>(null);
  const [slashPos, setSlashPos] = useState<Point | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState<{ mode: TransformMode; abort: AbortController } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const streamRangeRef = useRef<{ from: number; to: number } | null>(null);
  const targetRef = useRef<{ from: number; to: number } | null>(null);
  const slashPosRef = useRef(0);
  const slashOpenRef = useRef(false);
  slashOpenRef.current = slashOpen;

  const placeAt = (view: EditorView, pos: number): Point | null => {
    const container = containerRef.current;
    if (!container) return null;
    const coords = view.coordsAtPos(pos);
    if (!coords) return null;
    const rect = container.getBoundingClientRect();
    return { left: coords.left - rect.left, top: coords.top - rect.top };
  };

  const closeAllMenus = () => {
    setBubble(null);
    setBubblePos(null);
    setSlashOpen(false);
    setSlashPos(null);
  };

  const dismissSlash = () => {
    const view = viewRef.current;
    if (view) {
      const pos = slashPosRef.current;
      view.dispatch({
        changes: { from: pos - 1, to: pos, insert: "" },
        selection: { anchor: pos - 1 },
      });
      view.focus();
    }
    setSlashOpen(false);
    setSlashPos(null);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: contentRef.current,
      extensions: [
        lineNumbers(),
        history(),
        markdown(),
        personaTheme,
        highlightExtensions,
        citationHighlightField,
        cmAiExtension({
          onSelection: (sel) => {
            const view = viewRef.current;
            if (!sel || !view) {
              setBubble(null);
              setBubblePos(null);
              return;
            }
            targetRef.current = { from: sel.from, to: sel.to };
            setBubble({ from: sel.from, to: sel.to });
            setBubblePos(placeAt(view, sel.from));
          },
          onSlash: (view, pos) => {
            slashPosRef.current = pos;
            setSlashPos(placeAt(view, pos));
            setSlashOpen(true);
          },
        }),
        rangeTracker(
          () => streamRangeRef.current,
          (r) => {
            streamRangeRef.current = r;
          },
        ),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDocContent(docPath, update.state.doc.toString());
          }
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              const store = useStore.getState();
              const doc = store.docs.find((d) => d.path === docPath);
              if (doc) {
                store.markDocSaving(docPath);
                void api
                  .saveFile(doc.path, doc.content)
                  .then(() => {
                    useStore.getState().markDocSaved(docPath, doc.content);
                    sounds.save();
                    useStore.getState().suggestAndApplyTags(docPath);
                  })
                  .catch(() => {
                    useStore.getState().markDocSaveFailed(docPath);
                  });
              }
              return true;
            },
          },
          {
            key: "Escape",
            preventDefault: true,
            run: () => {
              if (slashOpenRef.current) {
                dismissSlash();
                return true;
              }
              return false;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
      ],
    });
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;
    // Close floating menus when the editor scrolls (their coords go stale).
    const onScroll = () => closeAllMenus();
    view.dom.addEventListener("scroll", onScroll, { passive: true });
    if (useStore.getState().activeDocPath === docPath) view.focus();
    return () => {
      view.dom.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
      closeAllMenus();
      // Flush pending edits when the editor unmounts (view switch, tab
      // close) so unsaved work always reaches disk even if the debounced
      // autosave never fired.
      const store = useStore.getState();
      const doc = store.docs.find((d) => d.path === docPath);
      if (doc && doc.kind === "text" && doc.status === "unsaved") {
        void api.saveFile(doc.path, doc.content).catch(() => {});
      }
    };
    // mount once per doc path — parent keys this component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath]);

  // jump to a cited line (chat sources): scroll, select, flash the line
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !pendingLineJump || pendingLineJump.path !== docPath) return;
    const lineNo = Math.max(1, Math.min(pendingLineJump.line, view.state.doc.lines));
    const line = view.state.doc.line(lineNo);
    const effects: StateEffect<unknown>[] = [
      EditorView.scrollIntoView(line.from, { y: "center" }),
    ];
    if (line.length > 0) {
      effects.push(highlightLine.of({ from: line.from, to: line.to }));
    }
    view.dispatch({ selection: { anchor: line.from }, effects });
    view.focus();
    clearLineJump();
    if (line.length > 0) {
      setTimeout(() => {
        const v = viewRef.current;
        if (v) v.dispatch({ effects: clearHighlight.of(null) });
      }, 2200);
    }
  }, [pendingLineJump, docPath, clearLineJump]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
    }
  }, [content]);

  // autosave with debounce (empty content is a legitimate edit — deleting
  // everything must also hit disk)
  useEffect(() => {
    if (status === "saved" || status === "conflict") return;
    const timer = setTimeout(() => {
      const store = useStore.getState();
      store.markDocSaving(docPath);
      void api
        .saveFile(docPath, content)
        .then(() => {
          useStore.getState().markDocSaved(docPath, content);
        })
        .catch(() => {
          useStore.getState().markDocSaveFailed(docPath);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [content, docPath, status]);

  const runTransformAt = (range: { from: number; to: number }, mode: TransformMode, lang?: string) => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.sliceDoc(range.from, range.to);
    if (!text.trim()) return;
    closeAllMenus();
    const controller = new AbortController();
    setAiBusy({ mode, abort: controller });
    setAiError(null);
    let acc = "";
    streamRangeRef.current = { from: range.from, to: range.to };
    streamTransform(
      mode,
      text,
      {
        onDelta: (d) => {
          if (!viewRef.current) {
            controller.abort();
            return;
          }
          acc += d;
          const r = streamRangeRef.current;
          if (!r) return;
          view.dispatch({ changes: { from: r.from, to: r.to, insert: acc } });
          view.focus();
        },
        onDone: () => {
          streamRangeRef.current = null;
          setAiBusy(null);
          sounds.done();
        },
        onError: (msg) => {
          streamRangeRef.current = null;
          setAiBusy(null);
          setAiError(msg);
        },
      },
      { lang, signal: controller.signal },
    ).catch((e) => {
      streamRangeRef.current = null;
      setAiBusy(null);
      if ((e as Error).name !== "AbortError") setAiError((e as Error).message);
    });
  };

  const runTransform = (mode: TransformMode, lang?: string) => {
    const target = targetRef.current;
    if (target) runTransformAt(target, mode, lang);
  };

  const runSlashCommand = (mode: TransformMode, lang?: string) => {
    const view = viewRef.current;
    if (!view || !slashOpen) return;
    // Remove the "/" — the selection and paragraph are then already mapped
    // to the new document, so no manual adjustment is needed.
    view.dispatch({ changes: { from: slashPosRef.current - 1, to: slashPosRef.current, insert: "" } });
    const sel = view.state.selection.main;
    const target = sel.empty
      ? paragraphRange(view.state, view.state.selection.main.head)
      : { from: sel.from, to: sel.to };
    setSlashOpen(false);
    setSlashPos(null);
    runTransformAt(target, mode, lang);
  };

  return (
    <div ref={containerRef} className="relative h-full overflow-auto">
      {/* selection ✨ bubble */}
      {bubblePos && bubble && !aiBusy && (
        <div
          className="cm-ai-bubble absolute z-30"
          style={{ left: bubblePos.left, top: Math.max(4, bubblePos.top - 40) }}
        >
          <DropdownMenu.Root
            onOpenChange={(open) => {
              if (!open && !aiBusy) {
                setBubblePos(null);
                setBubble(null);
              }
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                title="AI assist"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11.5px] font-medium shadow-lg shadow-stone-900/20 hover:bg-stone-700 dark:hover:bg-white transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="cm-ai-bubble-popover min-w-[170px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-40 text-[13px]"
              >
                {EDITOR_ACTIONS.map((a) => (
                  <DropdownMenu.Item
                    key={a.mode}
                    onSelect={() => runTransform(a.mode)}
                    className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 focus:bg-stone-100 dark:focus:bg-stone-700/60"
                  >
                    {a.label}
                  </DropdownMenu.Item>
                ))}
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
                      className="min-w-[140px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-40 text-[13px] max-h-56 overflow-y-auto"
                    >
                      {LANGUAGES.map((l) => (
                        <DropdownMenu.Item
                          key={l}
                          onSelect={() => runTransform("translate", l)}
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
        </div>
      )}

      {/* slash command menu */}
      {slashOpen && slashPos && (
        <div
          className="cm-ai-bubble absolute z-30"
          style={{ left: slashPos.left, top: slashPos.top + 8 }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              dismissSlash();
            }
          }}
        >
          <div className="min-w-[190px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/10 p-1 text-[13px]">
            <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Transform paragraph
            </div>
            {EDITOR_ACTIONS.map((a) => (
              <button
                key={a.mode}
                onClick={() => runSlashCommand(a.mode)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/60 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="font-mono text-[11.5px] text-stone-400 dark:text-stone-500">/</span>
                {a.label.toLowerCase()}
              </button>
            ))}
            <div className="px-2.5 py-1 text-[10px] text-stone-400 dark:text-stone-500 border-t border-stone-100 dark:border-stone-800 mt-1">
              Esc to dismiss · applies to the current paragraph
            </div>
          </div>
        </div>
      )}

      {/* streaming indicator */}
      {aiBusy && (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-sm">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          <span className="text-[11.5px] text-stone-600 dark:text-stone-300">
            {MODE_LABEL[aiBusy.mode]}…
          </span>
          <button
            onClick={() => aiBusy.abort.abort()}
            title="Stop"
            className="p-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-400 hover:text-red-500 transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* error chip */}
      {aiError && !aiBusy && (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 shadow-sm max-w-[320px]">
          <span className="text-[11.5px] text-red-700 dark:text-red-300 truncate">{aiError}</span>
          <button
            onClick={() => setAiError(null)}
            className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/60 text-red-400 shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
