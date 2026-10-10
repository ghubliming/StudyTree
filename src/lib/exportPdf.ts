import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFPage,
  PDFRef,
  StandardFonts,
  rgb,
  type PDFFont,
  type RGB,
} from "pdf-lib";
import { buildOutline, mdToPlain, noteLabels, topicLabels } from "./outline";
import { allTopics, activeLeafOf, threadTo, topicStats, type NodeMap } from "./tree";
import { PACK_ATTACHMENT_NAME, type DocMeta, type NoteNode, type Rect } from "./types";

/**
 * Annotated PDF export.
 *
 * A PDF viewer can only show so much on a page, so the export is layered:
 *  1. On the original pages: highlights, topic badges and note boxes drawn into
 *     the page, plus real PDF comment annotations carrying the full text.
 *  2. A "Study notes" appendix with every topic's full discussion tree
 *     (branches included). Badges link to it and it links back.
 *  3. Optionally the lossless `.studytree` pack embedded as a PDF attachment,
 *     so re-opening this PDF in StudyTree restores the whole session.
 */

export interface PdfExportOptions {
  pdfBytes: ArrayBuffer | Uint8Array;
  doc: DocMeta;
  nodes: NodeMap;
  fonts?: { regular: Uint8Array; bold: Uint8Array };
  appendix?: boolean;
  drawNotes?: boolean;
  /** Bytes of a `.studytree` pack to embed for lossless re-import. */
  embedPack?: Uint8Array;
}

function hex(color: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const n = m ? parseInt(m[1], 16) : 0xf5b700;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function rgbArray(c: RGB): number[] {
  return [c.red, c.green, c.blue];
}

const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
  "…": "...", "•": "*", " ": " ", "→": "->", "↳": "->", "←": "<-",
};

/** Make text drawable with the given font: swap or drop glyphs it lacks. */
function makeSanitizer(font: PDFFont) {
  const charset = new Set(font.getCharacterSet());
  return (text: string) => {
    let out = "";
    for (const ch of text.replace(/\t/g, "  ")) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n" || charset.has(cp)) out += ch;
      else if (REPLACEMENTS[ch] && [...REPLACEMENTS[ch]].every((c) => charset.has(c.codePointAt(0)!))) out += REPLACEMENTS[ch];
      else if (cp >= 0x1f000 || (cp >= 0x2600 && cp < 0x2800) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) continue; // emoji
      else out += "?";
    }
    return out;
  };
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    // Break on spaces, and also between CJK characters which carry no spaces.
    const tokens = para.match(/[　-鿿가-힯＀-￯]|\S+\s*|\s+/g) ?? [para];
    let line = "";
    for (const tok of tokens) {
      const trial = line + tok;
      if (font.widthOfTextAtSize(trial.trimEnd(), size) <= maxWidth) {
        line = trial;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      // A single token wider than the line: hard-split it.
      let rest = tok;
      while (font.widthOfTextAtSize(rest.trimEnd(), size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines;
}

/** Map a normalised (viewer-space) rect to PDF user space, honouring CropBox and /Rotate. */
function toUserSpace(page: PDFPage, r: Rect): { x: number; y: number; w: number; h: number } {
  const cb = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const map = (nx: number, ny: number): [number, number] => {
    switch (rot) {
      case 90: return [cb.x + ny * cb.width, cb.y + nx * cb.height];
      case 180: return [cb.x + (1 - nx) * cb.width, cb.y + ny * cb.height];
      case 270: return [cb.x + (1 - ny) * cb.width, cb.y + (1 - nx) * cb.height];
      default: return [cb.x + nx * cb.width, cb.y + (1 - ny) * cb.height];
    }
  };
  const [x1, y1] = map(r.x, r.y);
  const [x2, y2] = map(r.x + r.w, r.y + r.h);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function addAnnot(pdf: PDFDocument, page: PDFPage, dict: Record<string, unknown>): PDFRef {
  const ref = pdf.context.register(pdf.context.obj(dict as never));
  page.node.addAnnot(ref);
  return ref;
}

function commentAnnot(pdf: PDFDocument, page: PDFPage, at: { x: number; y: number }, title: string, body: string, color: RGB) {
  const now = PDFHexString.fromText(`D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`);
  addAnnot(pdf, page, {
    Type: "Annot",
    Subtype: "Text",
    Rect: [at.x, at.y, at.x + 18, at.y + 18],
    Contents: PDFHexString.fromText(body.slice(0, 30000)),
    T: PDFHexString.fromText(title),
    Subj: PDFHexString.fromText("StudyTree"),
    Name: "Comment",
    C: rgbArray(color),
    F: 4,
    Open: false,
    M: now,
  });
}

function linkAnnot(pdf: PDFDocument, page: PDFPage, rect: [number, number, number, number], target: PDFPage, top?: number) {
  addAnnot(pdf, page, {
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    F: 4,
    Dest: [target.ref, PDFName.of("XYZ"), PDFNull, top ?? target.getHeight(), PDFNull],
  });
}

const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.45, 0.52);
const ACCENT = rgb(0.18, 0.36, 0.92);

class AppendixWriter {
  page!: PDFPage;
  y = 0;
  readonly W = 595.28;
  readonly H = 841.89;
  readonly M = 54;
  pages: PDFPage[] = [];
  constructor(
    private pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly clean: (s: string) => string,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.pages.push(this.page);
    this.y = this.H - this.M;
    this.page.drawText(this.clean("StudyTree · Study notes"), { x: this.M, y: this.H - 30, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) {
    if (this.y - h < this.M) this.newPage();
  }
  gap(h: number) {
    this.y -= h;
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: RGB; indent?: number; bar?: RGB; lead?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.bold : this.font;
    const x = this.M + (o.indent ?? 0);
    const lead = o.lead ?? size * 1.38;
    const lines = wrap(this.clean(s), font, size, this.W - this.M - x);
    for (const line of lines) {
      this.ensure(lead);
      this.y -= lead;
      if (o.bar) this.page.drawRectangle({ x: x - 8, y: this.y - 3, width: 2, height: lead, color: o.bar });
      if (line) this.page.drawText(line, { x, y: this.y, size, font, color: o.color ?? INK });
    }
  }
}

export async function buildAnnotatedPdf(opts: PdfExportOptions): Promise<Uint8Array> {
  const { doc, nodes } = opts;
  const pdf = await PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = opts.fonts ? await pdf.embedFont(opts.fonts.regular, { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = opts.fonts ? await pdf.embedFont(opts.fonts.bold, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(font);

  const originalPages = pdf.getPages();
  const tl = topicLabels(nodes);
  const nl = noteLabels(nodes);
  const topics = allTopics(nodes).filter((t) => t.page >= 1 && t.page <= originalPages.length);
  const notes = Object.values(nodes).filter(
    (n): n is NoteNode => n.type === "note" && n.page >= 1 && n.page <= originalPages.length,
  );

  // ---- 1. Appendix first, so page badges can link into it.
  const topicTarget = new Map<string, { page: PDFPage; top: number }>();
  const pageTarget = new Map<number, { page: PDFPage; top: number }>();
  let appendixFirst: PDFPage | undefined;
  if (opts.appendix !== false && (topics.length || notes.length)) {
    const w = new AppendixWriter(pdf, font, bold, clean);
    appendixFirst = w.page;
    w.text(`Study notes — ${doc.title}`, { size: 18, bold: true, lead: 24 });
    const msgCount = Object.values(nodes).filter((n) => n.type === "msg").length;
    w.text(
      `${topics.length} topics · ${msgCount} messages · ${notes.length} notes · exported ${new Date().toLocaleDateString()}`,
      { size: 9, color: MUTED },
    );
    w.text("Coloured badges on the pages (T1, T2 …) link to the discussion here; each heading links back to its page.", { size: 9, color: MUTED });
    w.gap(10);

    for (const item of buildOutline(nodes)) {
      switch (item.kind) {
        case "page": {
          w.ensure(60);
          w.gap(12);
          w.text(`Page ${item.page}`, { size: 14, bold: true, color: ACCENT, lead: 18 });
          if (item.page <= originalPages.length) {
            linkAnnot(pdf, w.page, [w.M, w.y - 3, w.M + 120, w.y + 14], originalPages[item.page - 1]);
          }
          pageTarget.set(item.page, { page: w.page, top: w.y + 20 });
          w.page.drawLine({ start: { x: w.M, y: w.y - 5 }, end: { x: w.W - w.M, y: w.y - 5 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
          w.gap(6);
          break;
        }
        case "topic": {
          const t = item.topic;
          const s = topicStats(nodes, t.id);
          w.ensure(50);
          w.gap(8);
          topicTarget.set(t.id, { page: w.page, top: w.y + 14 });
          w.page.drawRectangle({ x: w.M, y: w.y - 14, width: 22, height: 13, color: hex(t.color) });
          w.page.drawText(item.label, { x: w.M + 3, y: w.y - 11, size: 8, font: bold, color: rgb(1, 1, 1) });
          w.text(t.title, { size: 11.5, bold: true, indent: 28, lead: 14 });
          w.text(
            `${s.messages} messages · ${s.leaves} thread ending${s.leaves === 1 ? "" : "s"}${s.branches ? ` · ${s.branches} branch${s.branches === 1 ? "" : "es"}` : ""}`,
            { size: 8, color: MUTED, indent: 28 },
          );
          if (t.anchor.quote) w.text(`"${t.anchor.quote}"`, { size: 9, color: MUTED, indent: 14, bar: hex(t.color) });
          else if (t.anchor.kind === "region") w.text("(Selected region of the page)", { size: 9, color: MUTED, indent: 14 });
          w.gap(4);
          break;
        }
        case "branch":
          w.gap(3);
          w.text(`-> Branch ${item.index} of ${item.count}`, { size: 8.5, bold: true, color: ACCENT, indent: 10 + item.indent * 14 });
          break;
        case "msg": {
          const indent = 14 + item.indent * 14;
          const user = item.msg.role === "user";
          w.gap(2);
          w.text(`${user ? "You" : "Tutor"}${item.msg.action ? ` (${item.msg.action})` : ""}`, {
            size: 8.5, bold: true, color: user ? ACCENT : rgb(0.1, 0.55, 0.35), indent,
          });
          w.text(mdToPlain(item.msg.content), { size: 9.5, indent, bar: item.indent ? rgb(0.82, 0.85, 0.92) : undefined });
          break;
        }
        case "note":
          w.gap(6);
          w.text(`Note ${item.label}`, { size: 9, bold: true, color: rgb(0.6, 0.45, 0) });
          w.text(mdToPlain(item.note.content), { size: 9.5, indent: 10, bar: hex("#f5b700") });
          break;
      }
    }
  }

  // ---- 2. Marks on the original pages.
  for (const t of topics) {
    const page = originalPages[t.page - 1];
    const color = hex(t.color);
    const rects = t.anchor.rects.map((r) => toUserSpace(page, r));
    if (t.anchor.kind === "text") {
      for (const r of rects) page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color, opacity: 0.28 });
    } else if (t.anchor.kind === "region") {
      for (const r of rects)
        page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: color, borderWidth: 1.5, borderDashArray: [4, 3], opacity: 0 });
    }
    // Badge at the top-left of the anchor (or the top margin for page topics).
    const first = rects[0] ?? toUserSpace(page, { x: 0.02, y: 0.02, w: 0.1, h: 0.03 });
    const label = tl.get(t.id)!;
    const bw = bold.widthOfTextAtSize(label, 7) + 6;
    const pageBox = page.getCropBox();
    const bx = Math.max(pageBox.x + 2, Math.min(first.x - bw - 2, pageBox.x + pageBox.width - bw - 2));
    const by = Math.min(first.y + first.h - 9, pageBox.y + pageBox.height - 12);
    page.drawRectangle({ x: bx, y: by, width: bw, height: 10, color });
    page.drawText(label, { x: bx + 3, y: by + 2.6, size: 7, font: bold, color: rgb(1, 1, 1) });

    const leaf = activeLeafOf(nodes, t);
    const thread = threadTo(nodes, leaf)
      .map((m) => `${m.role === "user" ? "Q" : "A"}: ${mdToPlain(m.content)}`)
      .join("\n\n");
    commentAnnot(pdf, page, { x: Math.max(pageBox.x, bx - 20), y: by - 4 }, `${label} · ${t.title}`, `${t.anchor.quote ? `"${t.anchor.quote}"\n\n` : ""}${thread}`, color);
    const target = topicTarget.get(t.id);
    if (target) linkAnnot(pdf, page, [bx, by, bx + bw, by + 10], target.page, target.top);
  }

  for (const n of notes) {
    const page = originalPages[n.page - 1];
    const r = toUserSpace(page, n.box);
    const label = nl.get(n.id)!;
    const body = mdToPlain(n.content);
    if (opts.drawNotes !== false) {
      const fill = hex(n.color);
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: fill, opacity: 0.95, borderColor: rgb(0.75, 0.62, 0.15), borderWidth: 0.8 });
      if (page.getRotation().angle % 360 === 0) {
        const size = Math.max(5.5, Math.min(9, r.w / 26));
        const lead = size * 1.3;
        const maxLines = Math.max(1, Math.floor((r.h - size * 2.2) / lead));
        let lines = wrap(clean(body), font, size, r.w - 8);
        if (lines.length > maxLines) {
          lines = lines.slice(0, Math.max(1, maxLines - 1));
          lines.push("... (full note in comment / appendix)");
        }
        page.drawText(clean(`${label} · Note`), { x: r.x + 4, y: r.y + r.h - size - 3, size: size * 0.9, font: bold, color: rgb(0.45, 0.35, 0) });
        lines.forEach((line, i) => {
          if (line) page.drawText(line, { x: r.x + 4, y: r.y + r.h - size * 2.2 - 3 - i * lead, size, font, color: INK });
        });
      }
    }
    const cb = page.getCropBox();
    commentAnnot(pdf, page, { x: Math.min(r.x + r.w + 2, cb.x + cb.width - 18), y: r.y + r.h - 18 }, `${label} · Note`, body, hex("#f5b700"));
    const target = (n.parentId && topicTarget.get(n.parentId)) || pageTarget.get(n.page);
    if (target && opts.drawNotes !== false) linkAnnot(pdf, page, [r.x, r.y, r.x + r.w, r.y + Math.min(14, r.h)], target.page, target.top);
  }

  // ---- 3. Metadata + embedded lossless session.
  pdf.setTitle(`${doc.title} — annotated`);
  pdf.setCreator("StudyTree");
  pdf.setProducer("StudyTree (pdf-lib)");
  pdf.setKeywords(["StudyTree", "study notes"]);
  if (appendixFirst) pdf.setSubject(`Study notes appendix starts on page ${originalPages.length + 1}`);
  if (opts.embedPack) {
    await pdf.attach(opts.embedPack, PACK_ATTACHMENT_NAME, {
      mimeType: "application/zip",
      description: "StudyTree session — open this PDF in StudyTree to continue with every topic, branch and note.",
      creationDate: new Date(),
      modificationDate: new Date(),
    });
  }
  return pdf.save();
}

