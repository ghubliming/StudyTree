import JSZip from "jszip";
import { buildMarkdown } from "./exportMarkdown";
import type { NodeMap } from "./tree";
import type { DocMeta, StudyNode, StudyPackManifest } from "./types";

export { PACK_ATTACHMENT_NAME, PACK_EXT } from "./types";

/**
 * The `.studytree` study pack: a ZIP holding the original PDF plus the full
 * discussion tree. It is the lossless format — no limit on comments, branches
 * or note length, and it re-imports exactly.
 *
 *   manifest.json   format/version, document metadata, every node
 *   document.pdf    the original, unannotated PDF
 *   notes.md        human-readable export of the same content
 */

export async function buildPack(doc: DocMeta, nodes: NodeMap, pdfBytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const manifest: StudyPackManifest = {
    format: "studytree",
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "StudyTree 1.0",
    doc,
    nodes: Object.values(nodes),
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("document.pdf", pdfBytes);
  zip.file("notes.md", buildMarkdown(doc, nodes));
  zip.file(
    "README.txt",
    "StudyTree study pack.\nOpen it in StudyTree (Import) to continue studying with every topic, branch and note intact.\n",
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export interface ParsedPack {
  manifest: StudyPackManifest;
  pdf: Uint8Array;
}

export async function readPack(bytes: ArrayBuffer | Uint8Array): Promise<ParsedPack> {
  const zip = await JSZip.loadAsync(bytes);
  const mf = zip.file("manifest.json");
  const pdf = zip.file("document.pdf");
  if (!mf || !pdf) throw new Error("Not a StudyTree pack (missing manifest.json or document.pdf).");
  const manifest = JSON.parse(await mf.async("string")) as StudyPackManifest;
  if (manifest.format !== "studytree") throw new Error("Unrecognised study pack format.");
  if (manifest.version > 1) throw new Error("This study pack was made by a newer StudyTree version.");
  return { manifest, pdf: await pdf.async("uint8array") };
}

/** Give imported content fresh ids so a pack can be imported twice side by side. */
export function remapIds(nodes: StudyNode[], newDocId: string, mkId: () => string): StudyNode[] {
  const map = new Map<string, string>();
  for (const n of nodes) map.set(n.id, mkId());
  const re = (id: string | null | undefined) => (id ? (map.get(id) ?? null) : null);
  return nodes.map((n) => {
    const base = { ...n, id: map.get(n.id)!, docId: newDocId } as StudyNode;
    if (base.type === "msg") return { ...base, parentId: re(base.parentId)!, topicId: re(base.topicId)!, status: base.status === "streaming" ? "done" : base.status };
    if (base.type === "topic") return { ...base, parentId: null, activeLeafId: re(base.activeLeafId) ?? undefined };
    return { ...base, parentId: re(base.parentId), sourceId: re(base.sourceId) ?? undefined };
  });
}
