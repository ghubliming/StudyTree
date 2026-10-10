// The legacy build carries polyfills for very new JS APIs that pdf.js 6 relies on
// (e.g. Map.prototype.getOrInsertComputed), so it works in today's browsers.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rect } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };
export const TextLayer = pdfjs.TextLayer;

/** pdf.js transfers (detaches) the buffer it is given, so always hand it a copy. */
export async function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: new Uint8Array(bytes.slice(0)),
  }).promise;
}

export function closePdf(pdf: PDFDocumentProxy | null | undefined): Promise<void> {
  return pdf ? pdf.loadingTask.destroy().catch(() => {}) : Promise.resolve();
}

const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>();

/** Plain text of a page, cached per document. */
export function pageText(pdf: PDFDocumentProxy, pageNo: number): Promise<string> {
  let m = textCache.get(pdf);
  if (!m) textCache.set(pdf, (m = new Map()));
  let p = m.get(pageNo);
  if (!p) {
    p = pdf
      .getPage(pageNo)
      .then((page) => page.getTextContent())
      .then((tc) => {
        let out = "";
        for (const item of tc.items) {
          if ("str" in item) {
            out += item.str;
            out += item.hasEOL ? "\n" : " ";
          }
        }
        return out.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
      })
      .catch(() => "");
    m.set(pageNo, p);
  }
  return p;
}

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNo: number,
  targetWidth: number,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

export async function thumbnail(pdf: PDFDocumentProxy, width = 240): Promise<string> {
  const c = await renderPageToCanvas(pdf, 1, width);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Crop a normalised region of a page to a PNG data URL (used for diagram questions). */
export async function cropRegion(pdf: PDFDocumentProxy, pageNo: number, r: Rect): Promise<string> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  // Aim for ~1200px across the crop, bounded so huge pages stay reasonable.
  const scale = Math.min(4, Math.max(1.5, 1200 / (base.width * Math.max(r.w, 0.05))));
  const full = await renderPageToCanvas(pdf, pageNo, base.width * scale);
  const sx = Math.round(r.x * full.width);
  const sy = Math.round(r.y * full.height);
  const sw = Math.max(1, Math.round(r.w * full.width));
  const sh = Math.max(1, Math.round(r.h * full.height));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}

/** Files embedded in the PDF (we use this to restore sessions from exported PDFs). */
export async function readAttachments(pdf: PDFDocumentProxy): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const atts = await pdf.getAttachments();
  if (!atts) return out;
  for (const [id, att] of atts) {
    let content = att.content ?? null;
    if (!content) {
      try {
        content = await pdf.getAttachmentContent(id);
      } catch {
        content = null; // unreadable attachment: skip it
      }
    }
    if (content) out[att.filename || id] = content;
  }
  return out;
}
