import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type INumberingOptions,
} from "docx";
import PDFDocument from "pdfkit";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import { format, isPast, isToday, parseISO } from "date-fns";
import { basename, extname } from "node:path";
import { readFileContent } from "./fs.js";
import { listTasks } from "./tasks.js";
import type { Task, TaskPriority, TaskRecur } from "../shared/types.js";

const md = new MarkdownIt({ html: false, linkify: true });

/**
 * markdown-it has no GFM task-list support. Detect `- [x]` / `- [ ]` list
 * items in the token stream, mark the item, and strip the marker from the
 * rendered text so sinks can draw a real checkbox.
 */
function markTaskListItems(tokens: Token[]): void {
  for (const t of tokens) {
    if (t.type !== "list_item_open") continue;
    const kids = t.children;
    if (!kids || kids[0]?.type !== "paragraph_open") continue;
    const inline = kids[1];
    if (!inline || inline.type !== "inline" || !inline.children) continue;
    const first = inline.children.find((c) => c.type !== "text" || c.content.trim().length > 0);
    if (!first || first.type !== "text") continue;
    const match = /^\[([ xX])\]\s+/.exec(first.content);
    if (match) {
      t.meta = { task: match[1]!.toLowerCase() === "x" ? "done" : "todo" };
      first.content = first.content.slice(match[0].length);
    }
  }
}

const COLORS = {
  title: "1C1917",
  heading: "292524",
  body: "1C1917",
  muted: "78716C",
  code: "44403C",
  codeBg: "F5F5F4",
  border: "D6D3D1",
  link: "1D4ED8",
};

const CODE_FONT = "Consolas";
const MAX_LEVEL = 3;

interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
}

interface ListFrame {
  ordered: boolean;
  count: number;
  reference: string;
  /** Set when the list item is a GFM task (`- [x]` / `- [ ]`). */
  task?: "done" | "todo" | null;
}

type ParaStyle = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "body" | "quote" | "item";

interface ParaOpts {
  style: ParaStyle;
  /** List nesting level (0-based), -1 when not inside a list item. */
  level: number;
  quote: number;
  item: ListFrame | null;
}

interface Sink {
  paragraph(runs: InlineRun[], opts: ParaOpts): void;
  code(text: string, indentCount: number): void;
  hr(indentCount: number): void;
  table(rows: InlineRun[][][], indentCount: number): void;
}

let olSequence = 0;

function inlineRuns(tokens: Token[]): InlineRun[] {
  const runs: InlineRun[] = [];
  const state = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: null as string | null,
  };
  const walk = (toks: Token[]) => {
    for (const t of toks) {
      switch (t.type) {
        case "text":
          runs.push({
            text: t.content,
            bold: state.bold,
            italic: state.italic,
            strike: state.strike,
            code: state.code,
            link: state.link,
          });
          break;
        case "code_inline":
          runs.push({
            text: t.content,
            bold: false,
            italic: false,
            strike: false,
            code: true,
            link: null,
          });
          break;
        case "softbreak":
        case "hardbreak":
          runs.push({
            text: "\n",
            bold: state.bold,
            italic: state.italic,
            strike: state.strike,
            code: state.code,
            link: state.link,
          });
          break;
        case "strong_open":
          state.bold = true;
          break;
        case "strong_close":
          state.bold = false;
          break;
        case "em_open":
          state.italic = true;
          break;
        case "em_close":
          state.italic = false;
          break;
        case "s_open":
          state.strike = true;
          break;
        case "s_close":
          state.strike = false;
          break;
        case "link_open": {
          const href = t.attrGet("href");
          state.link = typeof href === "string" ? href : null;
          break;
        }
        case "link_close":
          state.link = null;
          break;
        case "image":
          break; // images are not embedded in exports
        default:
          if (t.children) walk(t.children);
          break;
      }
    }
  };
  walk(tokens);
  return runs;
}

function collectInline(tokens: Token[], start: number, closeType: string): { tokens: Token[]; endIndex: number } {
  const out: Token[] = [];
  let j = start;
  while (j < tokens.length && tokens[j]!.type !== closeType) {
    out.push(tokens[j]!);
    j += 1;
  }
  return { tokens: out, endIndex: j + 1 };
}

interface WalkerCtx {
  list: ListFrame[];
  quote: number;
  inItem: boolean;
  task: "done" | "todo" | null;
}

function walk(tokens: Token[], ctx: WalkerCtx, sink: Sink): void {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    switch (t.type) {
      case "heading_open": {
        const level = Math.min(Math.max(parseInt(t.tag.slice(1), 10) || 1, 1), 6);
        const inline = collectInline(tokens, i + 1, "heading_close");
        sink.paragraph(inlineRuns(inline.tokens), {
          style: `h${level}` as ParaStyle,
          level: -1,
          quote: ctx.quote,
          item: null,
        });
        i = inline.endIndex;
        break;
      }
      case "paragraph_open": {
        const inline = collectInline(tokens, i + 1, "paragraph_close");
        const inItem = ctx.inItem && ctx.list.length > 0;
        const frame = ctx.list[ctx.list.length - 1] ?? null;
        sink.paragraph(inlineRuns(inline.tokens), {
          style: inItem ? "item" : ctx.quote > 0 ? "quote" : "body",
          level: ctx.list.length - 1,
          quote: ctx.quote,
          item: inItem && frame ? { ...frame, task: ctx.task } : null,
        });
        i = inline.endIndex;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = t.type === "ordered_list_open";
        const frame: ListFrame = {
          ordered,
          count: 0,
          reference: ordered ? `persona-ol-${olSequence++}` : "persona-bullets",
        };
        const closeType = t.type.replace("_open", "_close");
        let j = i + 1;
        while (j < tokens.length && tokens[j]!.type !== closeType) {
          if (tokens[j]!.type === "list_item_open") {
            let k = j + 1;
            while (k < tokens.length && tokens[k]!.type !== "list_item_close") k += 1;
            frame.count += 1;
            const meta = tokens[j]!.meta as { task?: "done" | "todo" } | null;
            walk(tokens.slice(j + 1, k), { ...ctx, list: [...ctx.list, { ...frame, count: 0 }], inItem: true, task: meta?.task ?? null }, sink);
            j = k + 1;
            continue;
          }
          j += 1;
        }
        i = j + 1;
        break;
      }
      case "code_block":
      case "fence":
        sink.code(t.content, ctx.list.length + ctx.quote);
        i += 1;
        break;
      case "blockquote_open": {
        const inner: Token[] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j]!.type !== "blockquote_close") {
          inner.push(tokens[j]!);
          j += 1;
        }
        walk(inner, { ...ctx, quote: ctx.quote + 1, inItem: false, task: null }, sink);
        i = j + 1;
        break;
      }
      case "hr":
        sink.hr(ctx.list.length + ctx.quote);
        i += 1;
        break;
      case "table_open": {
        const rows: InlineRun[][][] = [];
        let current: InlineRun[][] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j]!.type !== "table_close") {
          const tt = tokens[j]!;
          if (tt.type === "tr_open") {
            current = [];
          } else if (tt.type === "tr_close") {
            rows.push(current);
          } else if (tt.type === "th_open" || tt.type === "td_open") {
            const inline = collectInline(tokens, j + 1, `${tt.type.slice(0, 2)}_close`);
            current.push(inlineRuns(inline.tokens));
            j = inline.endIndex;
            continue;
          }
          j += 1;
        }
        i = j + 1;
        sink.table(rows, ctx.list.length + ctx.quote);
        break;
      }
      case "html_block": {
        const text = t.content.replace(/<[^>]*>/g, "").trim();
        if (text) {
          sink.paragraph(
            [
              {
                text,
                bold: false,
                italic: false,
                strike: false,
                code: false,
                link: null,
              },
            ],
            { style: "body", level: -1, quote: ctx.quote, item: null },
          );
        }
        i += 1;
        break;
      }
      default:
        i += 1;
        break;
    }
  }
}

/* ------------------------------ DOCX sink ------------------------------ */

function runsToDocx(
  runs: InlineRun[],
  opts: { size?: number; color?: string; italic?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const r of runs) {
    const base = {
      bold: r.bold,
      italics: r.italic || Boolean(opts.italic),
      strike: r.strike,
      font: r.code ? CODE_FONT : undefined,
      size: r.code ? 19 : opts.size,
      color: r.code ? COLORS.code : r.link ? COLORS.link : opts.color,
    };
    const parts = r.text.split("\n");
    parts.forEach((part, idx) => {
      const textRun = new TextRun({
        ...base,
        text: part,
        break: idx > 0 ? 1 : undefined,
      });
      if (r.link && /^(https?:\/\/|mailto:)/i.test(r.link)) {
        out.push(new ExternalHyperlink({ link: r.link, children: [textRun] }));
      } else {
        out.push(textRun);
      }
    });
  }
  return out;
}

function orderedLevels() {
  return Array.from({ length: 9 }, (_, l) => ({
    level: l,
    format: LevelFormat.DECIMAL,
    text: "%1.",
    alignment: AlignmentType.LEFT,
    start: 1,
    style: {
      paragraph: { indent: { left: 720 + l * 360, hanging: 360 } },
    },
  }));
}

const HEADING_LEVELS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

class DocxSink implements Sink {
  readonly children: (Paragraph | Table)[] = [];
  readonly numbering: Array<NonNullable<INumberingOptions["config"]>[number]> = [];
  private readonly orderedRefs = new Set<string>();

  paragraph(runs: InlineRun[], opts: ParaOpts): void {
    if (runs.length === 0) return;
    const heading = HEADING_LEVELS[opts.style];
    if (heading) {
      this.children.push(new Paragraph({ heading, children: runsToDocx(runs) }));
      return;
    }
    if (opts.item?.task) {
      const done = opts.item.task === "done";
      this.children.push(
        new Paragraph({
          children: [
            new TextRun({ text: done ? "☑ " : "☐ ", bold: true, color: done ? "34D399" : COLORS.muted }),
            ...runsToDocx(runs),
          ],
          indent: { left: (opts.level + 1) * 360 },
          spacing: { after: 60 },
        }),
      );
      return;
    }
    if (opts.item) {
      const children = runsToDocx(runs);
      const level = Math.min(opts.level, MAX_LEVEL);
      if (opts.item.ordered) {
        if (!this.orderedRefs.has(opts.item.reference)) {
          this.orderedRefs.add(opts.item.reference);
          this.numbering.push({ reference: opts.item.reference, levels: orderedLevels() });
        }
        this.children.push(
          new Paragraph({
            children,
            numbering: { reference: opts.item.reference, level },
            spacing: { after: 60 },
          }),
        );
      } else {
        this.children.push(new Paragraph({ children, bullet: { level }, spacing: { after: 60 } }));
      }
      return;
    }
    if (opts.quote > 0) {
      this.children.push(
        new Paragraph({
          children: runsToDocx(runs, { color: COLORS.muted, italic: true }),
          indent: { left: (opts.level + 1 + opts.quote) * 360 },
          spacing: { after: 120 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: COLORS.border, space: 8 },
          },
        }),
      );
      return;
    }
    this.children.push(
      new Paragraph({
        children: runsToDocx(runs),
        indent: opts.level >= 0 ? { left: (opts.level + 1) * 360 } : undefined,
        spacing: { after: 120 },
      }),
    );
  }

  code(text: string, indentCount: number): void {
    this.children.push(
      new Paragraph({
        children: [new TextRun({ text, font: CODE_FONT, size: 18, color: COLORS.code })],
        shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg },
        indent: { left: 360 + indentCount * 360 },
        spacing: { before: 60, after: 120 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: COLORS.border, space: 6 },
        },
      }),
    );
  }

  hr(indentCount: number): void {
    this.children.push(
      new Paragraph({
        children: [],
        indent: { left: indentCount * 360 },
        spacing: { before: 120, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border, space: 1 } },
      }),
    );
  }

  table(rows: InlineRun[][][], indentCount: number): void {
    if (rows.length === 0) return;
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      },
      rows: rows.map(
        (cells, r) =>
          new TableRow({
            tableHeader: r === 0,
            children: cells.map(
              (cellRuns) =>
                new TableCell({
                  shading: r === 0 ? { type: ShadingType.CLEAR, fill: "FAFAF9" } : undefined,
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [
                    new Paragraph({
                      children: runsToDocx(cellRuns, {}),
                      spacing: { after: 0 },
                    }),
                  ],
                }),
            ),
          }),
      ),
    });
    this.children.push(
      new Paragraph({
        children: [],
        indent: { left: indentCount * 360 },
        spacing: { before: 120, after: 160 },
      }),
    );
    this.children.push(table);
    this.children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
  }
}

/* ------------------------------- PDF sink ------------------------------ */

const HELV_FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
} as const;

const CODE_FONTS = {
  regular: "Courier",
  bold: "Courier-Bold",
} as const;

const F_CODE = "Courier";
const F_CODE_BOLD = "Courier-Bold";

const PDF_PARA: Record<
  ParaStyle,
  { size: number; color: string; bold: boolean; before: number; after: number }
> = {
  h1: { size: 16, color: COLORS.heading, bold: true, before: 0.55, after: 0.3 },
  h2: { size: 13.5, color: COLORS.heading, bold: true, before: 0.45, after: 0.22 },
  h3: { size: 12, color: COLORS.heading, bold: true, before: 0.4, after: 0.18 },
  h4: { size: 11, color: COLORS.heading, bold: true, before: 0.35, after: 0.16 },
  h5: { size: 10.5, color: COLORS.heading, bold: true, before: 0.3, after: 0.16 },
  h6: { size: 10.5, color: COLORS.heading, bold: true, before: 0.3, after: 0.16 },
  body: { size: 10.5, color: COLORS.body, bold: false, before: 0, after: 0.3 },
  quote: { size: 10, color: COLORS.muted, bold: false, before: 0, after: 0.3 },
  item: { size: 10.5, color: COLORS.body, bold: false, before: 0, after: 0.14 },
};

class PdfSink implements Sink {
  private readonly doc: PDFKit.PDFDocument;
  private readonly left: number;
  private readonly contentWidth: number;
  private readonly bodyFonts: { regular: string; bold: string; italic: string; boldItalic: string };

  constructor(
    doc: PDFKit.PDFDocument,
    bodyFonts: { regular: string; bold: string; italic: string; boldItalic: string },
  ) {
    this.doc = doc;
    this.bodyFonts = bodyFonts;
    this.left = doc.page.margins.left;
    this.contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.lineGap(2);
  }

  paragraph(runs: InlineRun[], opts: ParaOpts): void {
    if (runs.length === 0) return;
    const d = this.doc;
    const st = PDF_PARA[opts.style];
    const indentPts = opts.item ? opts.level * 14 : (opts.level + 1 + opts.quote) * 14;
    const width = this.contentWidth - indentPts;
    d.font(st.bold ? this.bodyFonts.bold : this.bodyFonts.regular).fontSize(st.size).fillColor(st.color);
    d.moveDown(st.before);
    d.x = this.left + indentPts;
    let used = 0;
    if (opts.item) {
      const marker = opts.item.task
        ? opts.item.task === "done"
          ? "[x] "
          : "[ ] "
        : opts.item.ordered
          ? `${opts.item.count}. `
          : "\u2022  ";
      d.font(this.bodyFonts.regular).fillColor(COLORS.muted);
      d.text(marker, { width, continued: true });
      used = d.widthOfString(marker);
    }
    runs.forEach((r, i) => {
      const font = r.code
        ? r.bold
          ? F_CODE_BOLD
          : F_CODE
        : r.bold && r.italic
          ? this.bodyFonts.boldItalic
          : r.bold
            ? this.bodyFonts.bold
            : r.italic
              ? this.bodyFonts.italic
              : this.bodyFonts.regular;
      d.font(font).fillColor(r.code ? COLORS.code : st.color);
      d.text(r.text, { width: width - used, continued: i < runs.length - 1 });
    });
    d.moveDown(st.after);
  }

  code(text: string, indentCount: number): void {
    const d = this.doc;
    d.moveDown(0.15);
    d.font(F_CODE).fontSize(8.6).fillColor(COLORS.code);
    d.text(text, this.left + indentCount * 14, d.y, { width: this.contentWidth - indentCount * 14 });
    d.moveDown(0.35);
  }

  hr(indentCount: number): void {
    const d = this.doc;
    d.moveDown(0.35);
    if (d.y > d.page.height - 90) d.addPage();
    d.moveTo(this.left + indentCount * 14, d.y)
      .lineTo(this.left + this.contentWidth, d.y)
      .lineWidth(0.75)
      .strokeColor(COLORS.border)
      .stroke();
    d.moveDown(0.4);
  }

  table(rows: InlineRun[][][], indentCount: number): void {
    if (rows.length === 0) return;
    const plain = rows.map((row) => row.map((runs) => runs.map((r) => r.text).join("")));
    const colCount = Math.max(0, ...plain.map((r) => r.length));
    const widths = Array.from({ length: colCount }, () => 0);
    for (const row of plain) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i]!, cell.length);
      });
    }
    const d = this.doc;
    d.moveDown(0.2);
    const indent = indentCount * 14;
    plain.forEach((row, r) => {
      d.font(r === 0 ? F_CODE_BOLD : F_CODE).fontSize(8.4).fillColor(COLORS.body);
      const line = row.map((cell, i) => cell.padEnd(widths[i]! + 2)).join("");
      d.text(line, this.left + indent, d.y, { width: this.contentWidth - indent });
      if (r === 0) d.moveDown(0.05);
    });
    d.moveDown(0.35);
  }
}

/* ------------------------------ entry points ---------------------------- */

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const sink = new DocxSink();
  const tokens = md.parse(markdown, {});
  markTaskListItems(tokens);
  walk(tokens, { list: [], quote: 0, inItem: false, task: null }, sink);
  const doc = new Document({
    creator: "Persona",
    title,
    description: `Exported from Persona on ${new Date().toISOString()}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21, color: COLORS.body } },
        heading1: {
          run: { size: 30, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 320, after: 140 } },
        },
        heading2: {
          run: { size: 25, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading3: {
          run: { size: 22, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading4: {
          run: { size: 21, bold: true, color: COLORS.heading },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
        heading5: {
          run: { size: 21, bold: true, color: COLORS.muted },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
        heading6: {
          run: { size: 21, bold: true, italics: true, color: COLORS.muted },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      },
    },
    numbering: { config: sink.numbering },
    sections: [{ children: sink.children }],
  });
  return Packer.toBuffer(doc);
}

/**
 * Roboto TTFs ship with pdfmake as base64 in a virtual file system. Register
 * them with pdfkit so exported PDFs render full Unicode (emoji, CJK, etc.)
 * instead of the WinAnsi-only built-in Helvetica.
 */
const ROBOTO_FILES = ["Roboto-Regular.ttf", "Roboto-Medium.ttf", "Roboto-Italic.ttf", "Roboto-MediumItalic.ttf"] as const;

// Whether the pdfmake vfs ships the Roboto TTFs we register (module-level
// cache of the data check only). Fonts must be registered on every document.
let robotoReady: boolean | null = null;

function registerRobotoFonts(doc: PDFKit.PDFDocument): boolean {
  if (robotoReady === false) return false;
  try {
    const names: Record<string, string> = {
      "Roboto-Regular.ttf": "Roboto",
      "Roboto-Medium.ttf": "Roboto-Bold",
      "Roboto-Italic.ttf": "Roboto-Italic",
      "Roboto-MediumItalic.ttf": "Roboto-BoldItalic",
    };
    for (const file of ROBOTO_FILES) {
      const data = pdfFonts[file];
      if (typeof data !== "string" || data.length < 1000) throw new Error(`missing ${file}`);
      doc.registerFont(names[file]!, Buffer.from(data, "base64"));
    }
    robotoReady = true;
  } catch {
    robotoReady = false;
  }
  return robotoReady;
}

const ROBOTO_FONTS = {
  regular: "Roboto",
  bold: "Roboto-Bold",
  italic: "Roboto-Italic",
  boldItalic: "Roboto-BoldItalic",
} as const;

export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, right: 64, bottom: 64, left: 64 },
    info: { Title: title, Author: "Persona" },
  });
  const bodyFonts = registerRobotoFonts(doc) ? ROBOTO_FONTS : HELV_FONTS;
  const promise = collectPdf(doc);
  const sink = new PdfSink(doc, bodyFonts);
  const tokens = md.parse(markdown, {});
  markTaskListItems(tokens);
  walk(tokens, { list: [], quote: 0, inItem: false, task: null }, sink);
  doc.end();
  return promise;
}

/* ------------------------------- tasks --------------------------------- */

export interface TaskGroups {
  today: Task[];
  upcoming: Task[];
  completed: Task[];
}

export function groupTasksForExport(tasks: Task[]): TaskGroups {
  const today = format(new Date(), "yyyy-MM-dd");
  const groups: TaskGroups = { today: [], upcoming: [], completed: [] };
  for (const t of tasks) {
    if (t.status === "done") groups.completed.push(t);
    else if (t.due && t.due <= today) groups.today.push(t);
    else groups.upcoming.push(t);
  }
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  return groups;
}

function recurLabel(recur: TaskRecur | null): string {
  if (!recur) return "";
  if (recur === "daily") return "repeats daily";
  if (recur === "weekly") return "repeats weekly";
  if (recur === "monthly") return "repeats monthly";
  const n = parseInt(recur, 10);
  const unit = recur.slice(-1);
  const noun =
    unit === "d"
      ? n === 1
        ? "day"
        : "days"
      : unit === "w"
        ? n === 1
          ? "week"
          : "weeks"
        : n === 1
          ? "month"
          : "months";
  return `repeats every ${n} ${noun}`;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "high priority",
  medium: "",
  low: "low priority",
};

export function tasksToMarkdown(tasks: Task[], title: string): string {
  const { today, upcoming, completed } = groupTasksForExport(tasks);
  const lines: string[] = [`# ${title}`, "", `_Generated ${format(new Date(), "MMMM d, yyyy")}_`, ""];
  const section = (name: string, items: Task[]) => {
    if (items.length === 0) return;
    lines.push(`## ${name}`, "");
    for (const t of items) {
      const meta: string[] = [];
      if (t.due) {
        const overdue = t.status === "todo" && isPast(parseISO(t.due)) && !isToday(parseISO(t.due));
        meta.push(`due ${format(parseISO(t.due), "MMM d, yyyy")}${overdue ? " (overdue)" : ""}`);
      }
      if (t.project) meta.push(`#${t.project}`);
      if (PRIORITY_LABEL[t.priority]) meta.push(PRIORITY_LABEL[t.priority]);
      if (t.recur) meta.push(recurLabel(t.recur));
      const mark = t.status === "done" ? "x" : " ";
      lines.push(`- [${mark}] ${t.title}${meta.length > 0 ? ` — ${meta.join(" · ")}` : ""}`);
    }
    lines.push("");
  };
  section("Today", today);
  section("Upcoming", upcoming);
  section("Completed", completed);
  return lines.join("\n");
}

/* ------------------------------- routes -------------------------------- */

export async function exportNote(
  path: string,
  format: "pdf" | "docx",
  content?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const text = content ?? (await readFileContent(path));
  const title = basename(path, extname(path));
  const buffer =
    format === "docx" ? await markdownToDocx(text, title) : await markdownToPdf(text, title);
  return { buffer, filename: `${title}.${format}` };
}

export async function exportTasks(
  format: "pdf" | "docx",
  project: string | null,
): Promise<{ buffer: Buffer; filename: string }> {
  const tasks = (await listTasks()).filter((t) => !project || t.project === project);
  const title = project ? `Tasks - ${project}` : "All tasks";
  const markdown = tasksToMarkdown(tasks, title);
  const buffer =
    format === "docx" ? await markdownToDocx(markdown, title) : await markdownToPdf(markdown, title);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tasks";
  return { buffer, filename: `${slug}.${format}` };
}
