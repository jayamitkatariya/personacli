import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

export interface CmAiHandlers {
  /** Fires when a non-empty selection appears or collapses. */
  onSelection?: (sel: { from: number; to: number; text: string } | null) => void;
  /** Fires after "/" is typed at the start of a line (pos = after the slash). */
  onSlash?: (view: EditorView, pos: number) => void;
}

/**
 * AI-assist hooks for the editor: selection tracking (for the ✨ bubble) and
 * a Notion-style "/" trigger at line start (for the slash command menu).
 */
export function cmAiExtension(handlers: CmAiHandlers) {
  let lastFired: string | null = null;
  return [
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      const sel = update.state.selection.main;
      const key = sel.empty ? "" : `${sel.from}:${sel.to}`;
      if (key === lastFired) return;
      lastFired = key;
      if (sel.empty) {
        handlers.onSelection?.(null);
        return;
      }
      handlers.onSelection?.({
        from: sel.from,
        to: sel.to,
        text: update.state.sliceDoc(sel.from, sel.to),
      });
    }),
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text === "/" && from === to) {
        const line = view.state.doc.lineAt(from);
        const prefix = view.state.sliceDoc(line.from, from);
        if (/^\s*$/.test(prefix)) {
          view.dispatch(view.state.replaceSelection("/"));
          handlers.onSlash?.(view, from + 1);
          return true;
        }
      }
      return false;
    }),
  ];
}

/**
 * Maps an active {from,to} range through every document change, so a
 * streaming replacement stays anchored even if the user keeps typing.
 */
export function rangeTracker(
  getRange: () => { from: number; to: number } | null,
  setRange: (r: { from: number; to: number }) => void,
) {
  return EditorView.updateListener.of((update) => {
    const r = getRange();
    if (!r || !update.docChanged) return;
    let { from, to } = r;
    for (const tr of update.transactions) {
      const mappedFrom = tr.changes.mapPos(from, 1);
      const mappedTo = tr.changes.mapPos(to, -1);
      if (mappedFrom === from && mappedTo === to) continue;
      from = mappedFrom;
      to = mappedTo;
    }
    setRange({ from, to });
  });
}

/** The paragraph containing `pos` (blank-line delimited). */
export function paragraphRange(state: EditorState, pos: number): { from: number; to: number } {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  if (line.text.trim() === "") return { from: line.from, to: line.to };
  let from = line.from;
  let to = line.to;
  let l = line.number - 1;
  while (l >= 1) {
    const prev = doc.line(l);
    if (prev.text.trim() === "") break;
    from = prev.from;
    l--;
  }
  let r = line.number + 1;
  while (r <= doc.lines) {
    const next = doc.line(r);
    if (next.text.trim() === "") break;
    to = next.to;
    r++;
  }
  return { from, to };
}
