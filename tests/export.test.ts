import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildAnnotatedPdf } from "../src/lib/exportPdf";
import { buildMarkdown } from "../src/lib/exportMarkdown";
import { buildPack, readPack, remapIds } from "../src/lib/pack";
import type { NodeMap } from "../src/lib/tree";

const samplePack = readFileSync("public/samples/neural-networks.studytree");
const fonts = {
  regular: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")),
  bold: new Uint8Array(readFileSync("public/fonts/DejaVuSans-Bold.ttf")),
};

describe("study pack", () => {
  it("round-trips document and tree", async () => {
    const { manifest, pdf } = await readPack(samplePack);
    expect(manifest.format).toBe("studytree");
    expect(manifest.nodes.length).toBeGreaterThan(20);
    const nodes: NodeMap = Object.fromEntries(manifest.nodes.map((n) => [n.id, n]));
    const again = await readPack(await buildPack(manifest.doc, nodes, pdf));
    expect(again.manifest.nodes).toHaveLength(manifest.nodes.length);
    expect(again.pdf.byteLength).toBe(pdf.byteLength);
  });

  it("remaps ids consistently", async () => {
    const { manifest } = await readPack(samplePack);
    let i = 0;
    const out = remapIds(manifest.nodes, "new", () => `n${i++}`);
    const ids = new Set(out.map((n) => n.id));
    for (const n of out) {
      expect(n.docId).toBe("new");
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
      if (n.type === "msg") expect(ids.has(n.topicId)).toBe(true);
    }
  });

  it("renders markdown notes with branches", async () => {
    const { manifest } = await readPack(samplePack);
    const md = buildMarkdown(manifest.doc, Object.fromEntries(manifest.nodes.map((n) => [n.id, n])));
    expect(md).toContain("## Page 1");
    expect(md).toContain("Branch 2 of 2");
    expect(md).toContain("📝");
  });
});

describe("annotated PDF", () => {
  it("adds annotations, appendix and an embedded session", async () => {
    const { manifest, pdf } = await readPack(samplePack);
    const nodes: NodeMap = Object.fromEntries(manifest.nodes.map((n) => [n.id, n]));
    const out = await buildAnnotatedPdf({ pdfBytes: pdf, doc: manifest.doc, nodes, fonts, embedPack: new Uint8Array(samplePack) });
    const res = await PDFDocument.load(out);
    expect(res.getPageCount()).toBeGreaterThan(manifest.doc.pageCount);
    const annots = res.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const subtypes = annots.asArray().map((r) => (res.context.lookup(r) as PDFDict).get(PDFName.of("Subtype"))?.toString());
    expect(subtypes).toContain("/Text");
    expect(subtypes).toContain("/Link");
    const names = res.catalog.lookup(PDFName.of("Names"), PDFDict);
    expect(names.has(PDFName.of("EmbeddedFiles"))).toBe(true);
  });

  it("works with standard fonts and non-Latin text", async () => {
    const { manifest, pdf } = await readPack(samplePack);
    const nodes: NodeMap = Object.fromEntries(manifest.nodes.map((n) => [n.id, n]));
    const first = manifest.nodes.find((n) => n.type === "msg")!;
    nodes[first.id] = { ...first, content: "中文解释 — émoji 🎉 test" } as typeof first;
    const out = await buildAnnotatedPdf({ pdfBytes: pdf, doc: manifest.doc, nodes });
    expect((await PDFDocument.load(out)).getPageCount()).toBeGreaterThan(manifest.doc.pageCount);
  });
});
