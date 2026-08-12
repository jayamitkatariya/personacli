import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const personaTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--color-surface-raised)",
      color: "var(--color-ink)",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--color-blue-600)",
      padding: "calc(20px + var(--density-py)) 24px 60vh",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-blue-600)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { background: "var(--color-blue-100)" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "var(--color-surface-raised)",
      color: "var(--color-edge-strong)",
      border: "none",
      paddingLeft: "8px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--color-surface-raised)",
      color: "var(--color-ink-subtle)",
    },
    ".cm-foldGutter": { display: "none" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--color-soft)",
      outline: "1px solid var(--color-edge-strong)",
    },
  },
  { dark: false },
);

export const personaHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "600", color: "var(--color-ink)" },
  { tag: t.heading2, fontSize: "1.2em", fontWeight: "600", color: "var(--color-ink)" },
  { tag: t.heading3, fontSize: "1.05em", fontWeight: "600", color: "var(--color-ink)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--color-ink)" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--color-ink-subtle)" },
  { tag: t.link, color: "var(--color-blue-600)", textDecoration: "none" },
  { tag: t.url, color: "var(--color-blue-600)", textDecoration: "underline" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" },
  { tag: t.quote, color: "var(--color-ink-subtle)", fontStyle: "italic" },
  { tag: t.list, color: "var(--color-ink-muted)" },
  { tag: t.processingInstruction, color: "var(--color-ink-subtle)" },
  { tag: [t.escape, t.special(t.string)], color: "var(--color-blue-600)" },
  { tag: t.meta, color: "var(--color-ink-subtle)" },
  { tag: t.invalid, color: "#dc2626" },
]);

export const highlightExtensions = syntaxHighlighting(personaHighlight);
