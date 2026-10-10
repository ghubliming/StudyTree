import { useState } from "react";
import { PACK_EXT } from "../lib/types";
import { setShowExport, toast, useStore } from "../store/useStore";
import { Icon } from "./Icon";

function download(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "study";
}

let fontCache: Promise<{ regular: Uint8Array; bold: Uint8Array } | undefined> | null = null;
function loadFonts() {
  fontCache ??= Promise.all(["fonts/DejaVuSans.ttf", "fonts/DejaVuSans-Bold.ttf"].map((u) => fetch(import.meta.env.BASE_URL + u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))))
    .then(([a, b]) => ({ regular: new Uint8Array(a), bold: new Uint8Array(b) }))
    .catch(() => undefined);
  return fontCache;
}

export function ExportDialog() {
  const doc = useStore((s) => s.doc)!;
  const nodes = useStore((s) => s.nodes);
  const bytes = useStore((s) => s.pdfBytes)!;
  const [drawNotes, setDrawNotes] = useState(true);
  const [appendix, setAppendix] = useState(true);
  const [embed, setEmbed] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const base = safeName(doc.title);
  const counts = Object.values(nodes).reduce(
    (a, n) => ({ ...a, [n.type]: (a[n.type] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  const run = async (label: string, fn: () => Promise<void>) => {
    setWorking(label);
    try {
      await fn();
      toast(`${label} ready`, "success");
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="modal-back" onClick={() => setShowExport(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-head">
          <h2 id="export-title">Export &amp; save</h2>
          <button className="btn ghost icon" onClick={() => setShowExport(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>
            {counts.topic ?? 0} topics · {counts.msg ?? 0} messages · {counts.note ?? 0} notes. Everything is also saved automatically in this browser.
          </p>

          <div className="export-opt">
            <h3>
              <Icon name="file" /> Annotated PDF <span className="tag">share</span>
            </h3>
            <p>
              Opens in any PDF reader. Highlights, topic badges and note boxes are drawn on the pages, every topic and note is
              a PDF comment, and a linked “Study notes” appendix holds the full discussion tree — so nothing is lost even
              when the page has no room.
            </p>
            <label><input type="checkbox" checked={drawNotes} onChange={(e) => setDrawNotes(e.target.checked)} /> Draw note boxes on the pages</label>
            <label><input type="checkbox" checked={appendix} onChange={(e) => setAppendix(e.target.checked)} /> Add the study-notes appendix (all branches)</label>
            <label><input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} /> Embed the editable session (re-open this PDF in StudyTree to continue)</label>
            <div className="row">
              <button
                className="btn primary"
                disabled={!!working}
                onClick={() =>
                  run("Annotated PDF", async () => {
                    const [{ buildAnnotatedPdf }, { buildPack }, fonts] = await Promise.all([
                      import("../lib/exportPdf"),
                      import("../lib/pack"),
                      loadFonts(),
                    ]);
                    const pack = embed ? await buildPack(doc, nodes, bytes) : undefined;
                    const out = await buildAnnotatedPdf({ pdfBytes: bytes, doc, nodes, fonts, appendix, drawNotes, embedPack: pack });
                    download(out, `${base} (annotated).pdf`, "application/pdf");
                  })
                }
              >
                <Icon name="download" /> {working === "Annotated PDF" ? "Building…" : "Download PDF"}
              </button>
            </div>
          </div>

          <div className="export-opt">
            <h3>
              <Icon name="tree" /> Study pack <code>{PACK_EXT}</code> <span className="tag">lossless</span>
            </h3>
            <p>
              The advanced format: the original document plus the complete tree (topics, every branch, notes, positions) in
              one file. No limits on how many comments it holds. Import it on any device to pick up exactly where you left off.
            </p>
            <div className="row">
              <button
                className="btn"
                disabled={!!working}
                onClick={() =>
                  run("Study pack", async () => {
                    const { buildPack } = await import("../lib/pack");
                    download(await buildPack(doc, nodes, bytes), `${base}${PACK_EXT}`, "application/zip");
                  })
                }
              >
                <Icon name="download" /> {working === "Study pack" ? "Packing…" : "Download study pack"}
              </button>
            </div>
          </div>

          <div className="export-opt">
            <h3>
              <Icon name="note" /> Markdown notes
            </h3>
            <p>Plain-text notes for Notion, Obsidian or a wiki: page → topic → discussion, with branches marked.</p>
            <div className="row">
              <button
                className="btn"
                disabled={!!working}
                onClick={() =>
                  run("Markdown", async () => {
                    const { buildMarkdown } = await import("../lib/exportMarkdown");
                    download(buildMarkdown(doc, nodes), `${base} — notes.md`, "text/markdown;charset=utf-8");
                  })
                }
              >
                <Icon name="download" /> Download .md
              </button>
              <button
                className="btn ghost"
                onClick={async () => {
                  const { buildMarkdown } = await import("../lib/exportMarkdown");
                  await navigator.clipboard?.writeText(buildMarkdown(doc, nodes));
                  toast("Markdown copied", "success");
                }}
              >
                <Icon name="copy" /> Copy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
