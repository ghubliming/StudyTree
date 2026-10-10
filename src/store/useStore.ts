import { create } from "zustand";
import { browserHealth, fetchHealth, saveBrowserAiSettings, streamChat, type ChatPayload, type Health, type TutorMode } from "../lib/ai";
import * as db from "../lib/db";
import { uid } from "../lib/id";
import { closePdf, cropRegion, loadPdf, pageText, readAttachments, thumbnail, type PDFDocumentProxy } from "../lib/pdf";
import {
  activeLeafOf, descendantIds, messageChildren, newestLeafUnder, pathTo, siblingInfo, threadTo, topicsOnPage, type NodeMap,
} from "../lib/tree";
import {
  NOTE_COLORS, PACK_ATTACHMENT_NAME, TOPIC_COLORS, type Anchor, type DocMeta, type MessageNode, type NoteNode, type Rect, type StudyNode, type TopicNode,
} from "../lib/types";

export type Tool = "select" | "region" | "note";
export type RightTab = "thread" | "map";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

interface State {
  view: "library" | "workspace";
  health: Health | null;
  docs: DocMeta[];
  busy: string | null;
  toasts: Toast[];

  doc: DocMeta | null;
  pdf: PDFDocumentProxy | null;
  pdfBytes: ArrayBuffer | null;
  nodes: NodeMap;
  selectedTopicId: string | null;
  currentPage: number;
  zoom: number;
  tool: Tool;
  rightTab: RightTab;
  /** Message the composer will reply to when it differs from the active leaf (a fork). */
  replyTo: string | null;
  /** Message to scroll into view / flash in the thread. */
  focusMsgId: string | null;
  scrollTo: { page: number; y?: number; nonce: number } | null;
  composerNonce: number;
  showExport: boolean;
  showAiSettings: boolean;
  /** Note currently in edit mode on the page. */
  editingNoteId: string | null;
  selectedNoteId: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
}

const initial: State = {
  view: "library",
  health: null,
  docs: [],
  busy: null,
  toasts: [],
  doc: null,
  pdf: null,
  pdfBytes: null,
  nodes: {},
  selectedTopicId: null,
  currentPage: 1,
  zoom: 1,
  tool: "select",
  rightTab: "thread",
  replyTo: null,
  focusMsgId: null,
  scrollTo: null,
  composerNonce: 0,
  showExport: false,
  showAiSettings: false,
  editingNoteId: null,
  selectedNoteId: null,
  leftOpen: true,
  rightOpen: true,
};

export const useStore = create<State>(() => initial);
const set = useStore.setState;
const get = useStore.getState;

const controllers = new Map<string, AbortController>();
let toastSeq = 0;

// ------------------------------------------------------------------ helpers

export function toast(text: string, kind: Toast["kind"] = "info") {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 3500);
}

function persist(changed: StudyNode[], deleted: string[] = []) {
  const doc = get().doc;
  if (changed.length) db.putNodes(changed).catch((e) => toast(`Could not save: ${e}`, "error"));
  if (deleted.length) db.deleteNodes(deleted).catch(() => {});
  if (doc) {
    const updated = { ...doc, updatedAt: Date.now() };
    set({ doc: updated });
    db.putDoc(updated).catch(() => {});
  }
}

function upsert(...list: StudyNode[]) {
  set((s) => {
    const nodes = { ...s.nodes };
    for (const n of list) nodes[n.id] = n;
    return { nodes };
  });
  persist(list);
}

function patchNode<T extends StudyNode>(id: string, patch: Partial<T>, save = true): T | undefined {
  const cur = get().nodes[id] as T | undefined;
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updatedAt: Date.now() } as T;
  set((s) => ({ nodes: { ...s.nodes, [id]: next } }));
  if (save) persist([next]);
  return next;
}

function now() {
  return Date.now();
}

function extOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

// ------------------------------------------------------------------ library

export async function init() {
  const [health, docs] = await Promise.all([fetchHealth(), db.listDocs().catch(() => [])]);
  set({ health, docs });
  window.addEventListener("hashchange", syncFromHash);
  await syncFromHash();
}

function docIdFromHash(): string | null {
  const m = /^#\/doc\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Hash routing: #/ is the library, #/doc/<id> a document (so Back works). */
async function syncFromHash() {
  const id = docIdFromHash();
  const { view, doc, docs } = get();
  if (id && id !== doc?.id && docs.some((d) => d.id === id)) await openDoc(id);
  else if (!id && view === "workspace") closeDoc();
}

export async function refreshDocs() {
  set({ docs: await db.listDocs() });
}

export async function openDoc(id: string) {
  set({ busy: "Opening document…" });
  try {
    const [doc, bytes, nodeList] = await Promise.all([db.getDoc(id), db.getFile(id), db.getNodes(id)]);
    if (!doc || !bytes) throw new Error("Document not found in this browser.");
    const pdf = await loadPdf(bytes);
    const nodes: NodeMap = {};
    for (const n of nodeList) {
      // A reload mid-stream leaves a message "streaming"; settle it.
      nodes[n.id] = n.type === "msg" && n.status === "streaming" ? { ...n, status: n.content ? "done" : "error" } : n;
    }
    closePdf(get().pdf);
    set({
      ...initial,
      health: get().health,
      docs: get().docs,
      toasts: get().toasts,
      view: "workspace",
      doc,
      pdf,
      pdfBytes: bytes,
      nodes,
      currentPage: doc.lastPage ?? 1,
      scrollTo: doc.lastPage && doc.lastPage > 1 ? { page: doc.lastPage, nonce: now() } : null,
      leftOpen: window.innerWidth > 900,
      rightOpen: window.innerWidth > 700,
    });
    if (docIdFromHash() !== id) history.pushState(null, "", `#/doc/${encodeURIComponent(id)}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ busy: null });
  }
}

export function closeDoc() {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  closePdf(get().pdf);
  set({ view: "library", doc: null, pdf: null, pdfBytes: null, nodes: {}, selectedTopicId: null });
  if (docIdFromHash()) history.pushState(null, "", "#/");
  refreshDocs();
}

export async function deleteDocument(id: string) {
  await db.deleteDoc(id);
  await refreshDocs();
  toast("Document deleted");
}

async function createDocFromPdf(
  bytes: ArrayBuffer,
  meta: { title: string; fileName: string; sourceType: string; id?: string },
  nodes: StudyNode[] = [],
): Promise<string> {
  const pdf = await loadPdf(bytes);
  const id = meta.id ?? uid("doc");
  const doc: DocMeta = {
    id,
    title: meta.title,
    fileName: meta.fileName,
    sourceType: meta.sourceType,
    pageCount: pdf.numPages,
    createdAt: now(),
    updatedAt: now(),
    thumbnail: await thumbnail(pdf).catch(() => undefined),
  };
  await closePdf(pdf);
  await db.putFile(id, bytes);
  await db.putDoc(doc);
  if (nodes.length) await db.putNodes(nodes.map((n) => ({ ...n, docId: id })));
  await refreshDocs();
  return id;
}

async function importPack(bytes: ArrayBuffer | Uint8Array, keepIds = false): Promise<string> {
  const { readPack, remapIds } = await import("../lib/pack");
  const { manifest, pdf } = await readPack(bytes);
  const pdfBuf = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const docId = keepIds ? manifest.doc.id : uid("doc");
  const nodes = keepIds ? manifest.nodes : remapIds(manifest.nodes, docId, () => uid("n"));
  return createDocFromPdf(
    pdfBuf,
    { id: docId, title: manifest.doc.title, fileName: manifest.doc.fileName, sourceType: manifest.doc.sourceType },
    nodes,
  );
}

const SLIDE_EXTS = new Set(["ppt", "pptx", "pps", "ppsx", "odp", "key", "doc", "docx", "odt", "rtf"]);
export const ACCEPT = ".pdf,.studytree,.ppt,.pptx,.pps,.ppsx,.odp,.key,.doc,.docx,.odt,.rtf";

export async function importFile(file: File) {
  const ext = extOf(file.name);
  set({ busy: `Importing ${file.name}…` });
  try {
    let id: string;
    if (ext === "studytree" || ext === "zip") {
      id = await importPack(await file.arrayBuffer());
      toast("Study pack imported — every topic, branch and note restored", "success");
    } else if (ext === "pdf") {
      const bytes = await file.arrayBuffer();
      const probe = await loadPdf(bytes);
      const atts = await readAttachments(probe).catch(() => ({}) as Record<string, Uint8Array>);
      await closePdf(probe);
      const embedded = atts[PACK_ATTACHMENT_NAME];
      if (embedded) {
        id = await importPack(embedded);
        toast("Restored the StudyTree session embedded in this PDF", "success");
      } else {
        id = await createDocFromPdf(bytes, { title: titleFromFile(file.name), fileName: file.name, sourceType: "pdf" });
      }
    } else if (SLIDE_EXTS.has(ext)) {
      if (!get().health?.convert) {
        throw new Error("This demo has no conversion server. Export the slides to PDF (File → Save as PDF) and upload the PDF.");
      }
      set({ busy: `Converting ${file.name} to PDF…` });
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${import.meta.env.BASE_URL}api/convert`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((err as { error?: string }).error ?? "Conversion failed");
      }
      id = await createDocFromPdf(await res.arrayBuffer(), {
        title: titleFromFile(file.name),
        fileName: file.name,
        sourceType: ext,
      });
    } else {
      throw new Error("Unsupported file. Use PDF, PowerPoint/Keynote/Word, or a .studytree pack.");
    }
    await openDoc(id);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ busy: null });
  }
}

export async function openSample() {
  const SAMPLE_ID = "sample_neural_networks";
  if (await db.getDoc(SAMPLE_ID)) return openDoc(SAMPLE_ID);
  set({ busy: "Loading sample chapter…" });
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/neural-networks.studytree`);
    if (!res.ok) throw new Error("Sample not found");
    const id = await importPack(await res.arrayBuffer(), true);
    await openDoc(id);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  } finally {
    set({ busy: null });
  }
}

// ------------------------------------------------------------------ navigation & UI

export function setCurrentPage(page: number) {
  if (get().currentPage === page) return;
  set({ currentPage: page });
  const doc = get().doc;
  if (doc) {
    const updated = { ...doc, lastPage: page };
    set({ doc: updated });
    db.putDoc(updated).catch(() => {});
  }
}

export function goToPage(page: number, y?: number) {
  const doc = get().doc;
  if (!doc) return;
  const p = Math.max(1, Math.min(doc.pageCount, page));
  set({ scrollTo: { page: p, y, nonce: now() } });
}

export function selectTopic(id: string | null, opts: { scroll?: boolean; tab?: RightTab } = {}) {
  set({ selectedTopicId: id, replyTo: null, rightOpen: id ? true : get().rightOpen, ...(opts.tab ? { rightTab: opts.tab } : {}) });
  if (id && opts.scroll) {
    const t = get().nodes[id] as TopicNode | undefined;
    if (t) goToPage(t.page, t.anchor.rects[0]?.y);
  }
}

export function setTool(tool: Tool) {
  set({ tool });
}
export function setZoom(z: number) {
  set({ zoom: Math.max(0.5, Math.min(3, Math.round(z * 100) / 100)) });
}
export function setRightTab(tab: RightTab) {
  set({ rightTab: tab });
}
export function toggleLeft() {
  set((s) => ({ leftOpen: !s.leftOpen }));
}
export function toggleRight() {
  set((s) => ({ rightOpen: !s.rightOpen }));
}
export function setEditingNote(id: string | null) {
  set({ editingNoteId: id, ...(id ? { selectedNoteId: id } : {}) });
}
export function selectNote(id: string | null) {
  set({ selectedNoteId: id });
}
export function setShowAiSettings(v: boolean) {
  set({ showAiSettings: v });
}
/** Static hosting only: store the learner's own API key in this browser. */
export function saveAiSettings(apiKey: string, model: string) {
  saveBrowserAiSettings(apiKey.trim(), model.trim());
  set({ health: browserHealth(), showAiSettings: false });
  toast(apiKey.trim() ? "Live AI enabled in this browser" : "Using the demo tutor", "success");
}
export function setShowExport(v: boolean) {
  set({ showExport: v });
}
export function setReplyTo(id: string | null) {
  set({ replyTo: id, composerNonce: now() });
}
export function focusComposer() {
  set({ composerNonce: now() });
}

// ------------------------------------------------------------------ topics

function nextTopicColor(page: number): string {
  const used = topicsOnPage(get().nodes, page).length;
  return TOPIC_COLORS[used % TOPIC_COLORS.length];
}

export async function createTopic(page: number, anchor: Anchor, title?: string): Promise<TopicNode> {
  const doc = get().doc!;
  const quote = anchor.quote?.replace(/\s+/g, " ").trim();
  const t: TopicNode = {
    id: uid("topic"),
    docId: doc.id,
    type: "topic",
    parentId: null,
    page,
    title:
      title ??
      (anchor.kind === "text" && quote
        ? quote.length > 64 ? quote.slice(0, 61).trimEnd() + "…" : quote
        : anchor.kind === "region"
          ? `Region on page ${page}`
          : `Page ${page}`),
    color: nextTopicColor(page),
    anchor: { ...anchor, quote },
    createdAt: now(),
    updatedAt: now(),
  };
  if (anchor.kind === "region" && anchor.rects[0] && get().pdf) {
    t.snapshot = await cropRegion(get().pdf!, page, anchor.rects[0]).catch(() => undefined);
  }
  upsert(t);
  set({ selectedTopicId: t.id, rightTab: "thread", rightOpen: true, replyTo: null, composerNonce: now() });
  return t;
}

export function renameTopic(id: string, title: string) {
  patchNode<TopicNode>(id, { title: title.trim() || "Untitled topic" });
}
export function recolorTopic(id: string, color: string) {
  patchNode<TopicNode>(id, { color });
}

export function deleteNode(id: string) {
  const n = get().nodes[id];
  if (!n) return;
  for (const d of [id, ...descendantIds(get().nodes, id)]) controllers.get(d)?.abort();
  const ids = [id, ...descendantIds(get().nodes, id)];
  const sel = get().selectedTopicId;
  set((s) => {
    const nodes = { ...s.nodes };
    for (const d of ids) delete nodes[d];
    // Detach notes that pointed at a removed message/topic rather than delete them.
    for (const v of Object.values(nodes)) {
      if (v.type === "note" && v.sourceId && ids.includes(v.sourceId)) nodes[v.id] = { ...v, sourceId: undefined };
    }
    return { nodes, selectedTopicId: sel && ids.includes(sel) ? null : sel };
  });
  persist([], ids);
  if (n.type === "msg") {
    const topic = get().nodes[n.topicId] as TopicNode | undefined;
    if (topic && topic.activeLeafId && ids.includes(topic.activeLeafId)) {
      patchNode<TopicNode>(topic.id, { activeLeafId: newestLeafUnder(get().nodes, n.parentId) });
    }
  }
}

// ------------------------------------------------------------------ branches

export function setActiveLeaf(topicId: string, leafId: string) {
  patchNode<TopicNode>(topicId, { activeLeafId: leafId });
  set({ replyTo: null });
}

export function switchBranch(msgId: string, dir: -1 | 1) {
  const nodes = get().nodes;
  const msg = nodes[msgId] as MessageNode | undefined;
  if (!msg) return;
  const info = siblingInfo(nodes, msg);
  const next = info.siblings[(info.index + dir + info.count) % info.count];
  setActiveLeaf(msg.topicId, newestLeafUnder(nodes, next.id));
}

// ------------------------------------------------------------------ AI

async function contextFor(page: number) {
  const { pdf, doc } = get();
  if (!pdf || !doc) return { pageText: "", contextText: undefined };
  const [cur, prev, next] = await Promise.all([
    pageText(pdf, page),
    page > 1 ? pageText(pdf, page - 1) : Promise.resolve(""),
    page < doc.pageCount ? pageText(pdf, page + 1) : Promise.resolve(""),
  ]);
  const ctx = [
    prev && `[Page ${page - 1}]\n${prev.slice(-2500)}`,
    next && `[Page ${page + 1}]\n${next.slice(0, 2500)}`,
  ].filter(Boolean).join("\n\n");
  return { pageText: cur, contextText: ctx || undefined };
}

async function payloadFor(topic: TopicNode, mode: TutorMode, history: { role: "user" | "assistant"; content: string }[]): Promise<ChatPayload> {
  const doc = get().doc!;
  const ctx = await contextFor(topic.page);
  return {
    mode,
    docTitle: doc.title,
    page: topic.page,
    pageCount: doc.pageCount,
    ...ctx,
    anchor: { kind: topic.anchor.kind, quote: topic.anchor.quote },
    topicTitle: topic.title,
    image: topic.snapshot,
    history,
  };
}

/** Generate an assistant reply as a child of `parent` (a user message). */
async function generateReply(topic: TopicNode, parent: MessageNode) {
  const doc = get().doc!;
  const reply: MessageNode = {
    id: uid("msg"),
    docId: doc.id,
    type: "msg",
    parentId: parent.id,
    topicId: topic.id,
    page: topic.page,
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: now(),
    updatedAt: now(),
  };
  set((s) => ({ nodes: { ...s.nodes, [reply.id]: reply } }));
  patchNode<TopicNode>(topic.id, { activeLeafId: reply.id });

  const history = threadTo(get().nodes, parent.id).map((m) => ({ role: m.role, content: m.content }));
  const ctrl = new AbortController();
  controllers.set(reply.id, ctrl);
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const cur = get().nodes[reply.id] as MessageNode | undefined;
    if (cur) set((s) => ({ nodes: { ...s.nodes, [reply.id]: { ...cur, content: pending } } }));
  };
  try {
    const full = await streamChat(
      await payloadFor(topic, "chat", history),
      (_d, all) => {
        pending = all;
        timer ??= setTimeout(flush, 40);
      },
      ctrl.signal,
    );
    if (timer) clearTimeout(timer);
    patchNode<MessageNode>(reply.id, { content: full, status: "done" });
    maybeAutoTitle(topic.id);
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (ctrl.signal.aborted) {
      patchNode<MessageNode>(reply.id, { content: pending || "_Stopped._", status: "done" });
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      patchNode<MessageNode>(reply.id, { content: pending ? `${pending}\n\n_${msg}_` : msg, status: "error" });
    }
  } finally {
    controllers.delete(reply.id);
  }
}

export function stopStreaming(msgId: string) {
  controllers.get(msgId)?.abort();
}

export function isStreaming(): boolean {
  return controllers.size > 0;
}

/** Ask a question in a topic. Replies under `parentId` (default: the active leaf). */
export async function ask(topicId: string, text: string, opts: { parentId?: string | null; action?: string } = {}) {
  const topic = get().nodes[topicId] as TopicNode | undefined;
  if (!topic || !text.trim()) return;
  const parentId = opts.parentId ?? get().replyTo ?? activeLeafOf(get().nodes, topic);
  const userMsg: MessageNode = {
    id: uid("msg"),
    docId: topic.docId,
    type: "msg",
    parentId,
    topicId,
    page: topic.page,
    role: "user",
    content: text.trim(),
    status: "done",
    createdAt: now(),
    updatedAt: now(),
    ...(opts.action ? { action: opts.action } : {}),
  };
  upsert(userMsg);
  set({ replyTo: null });
  await generateReply(topic, userMsg);
}

export async function regenerate(assistantId: string) {
  const msg = get().nodes[assistantId] as MessageNode | undefined;
  if (!msg || msg.role !== "assistant") return;
  const parent = get().nodes[msg.parentId] as MessageNode | undefined;
  const topic = get().nodes[msg.topicId] as TopicNode | undefined;
  if (parent && topic) await generateReply(topic, parent);
}

/** Editing a question never overwrites history: it forks a new branch. */
export async function editQuestion(userMsgId: string, text: string) {
  const msg = get().nodes[userMsgId] as MessageNode | undefined;
  if (!msg || msg.role !== "user") return;
  await ask(msg.topicId, text, { parentId: msg.parentId, action: msg.action });
}

const titling = new Set<string>();
async function maybeAutoTitle(topicId: string) {
  const topic = get().nodes[topicId] as TopicNode | undefined;
  if (!topic || titling.has(topicId)) return;
  const generic = /^(Page \d+|Region on page \d+)$/.test(topic.title) || topic.title.endsWith("…");
  const answered = messageChildren(get().nodes, topicId).length === 1 && threadTo(get().nodes, activeLeafOf(get().nodes, topic)).length === 2;
  if (!generic || !answered) return;
  titling.add(topicId);
  try {
    const history = threadTo(get().nodes, activeLeafOf(get().nodes, topic)).map((m) => ({ role: m.role, content: m.content }));
    const title = (await streamChat(await payloadFor(topic, "title", history), () => {})).replace(/^["'#*\s]+|["'.*\s]+$/g, "").slice(0, 70);
    if (title) renameTopic(topicId, title);
  } catch {
    /* keep the default title */
  } finally {
    titling.delete(topicId);
  }
}

// ------------------------------------------------------------------ notes

function defaultNoteBox(page: number, near?: Rect): Rect {
  const w = 0.3;
  const h = 0.13;
  const y = Math.max(0.02, Math.min(0.98 - h, near ? near.y : 0.08));
  // Prefer the right margin; stagger so successive notes don't stack exactly.
  const existing = Object.values(get().nodes).filter((n) => n.type === "note" && n.page === page).length;
  const x = Math.min(0.98 - w, 0.66 + (existing % 3) * 0.012);
  return { x, y: Math.min(0.98 - h, y + (existing % 3) * 0.02), w, h };
}

export function addNote(page: number, opts: { box?: Rect; content?: string; parentId?: string | null; sourceId?: string; color?: string; near?: Rect } = {}): NoteNode {
  const doc = get().doc!;
  const n: NoteNode = {
    id: uid("note"),
    docId: doc.id,
    type: "note",
    parentId: opts.parentId ?? null,
    page,
    box: opts.box ?? defaultNoteBox(page, opts.near),
    content: opts.content ?? "",
    color: opts.color ?? NOTE_COLORS[0],
    createdAt: now(),
    updatedAt: now(),
    ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
  };
  upsert(n);
  return n;
}

export function updateNote(id: string, patch: Partial<NoteNode>, save = true) {
  patchNode<NoteNode>(id, patch, save);
}

/** Drop the demo-mode banner so it doesn't end up in notes. */
function stripDemoBanner(text: string): string {
  return text.replace(/^> _Demo tutor[^\n]*\n+/, "").trim();
}

export function pinMessageAsNote(msgId: string) {
  const msg = get().nodes[msgId] as MessageNode | undefined;
  if (!msg) return;
  const topic = get().nodes[msg.topicId] as TopicNode | undefined;
  const n = addNote(msg.page, {
    content: stripDemoBanner(msg.content),
    parentId: msg.topicId,
    sourceId: msg.id,
    color: NOTE_COLORS[(topic ? TOPIC_COLORS.indexOf(topic.color) + 1 : 0) % NOTE_COLORS.length] ?? NOTE_COLORS[0],
    near: topic?.anchor.rects[0],
  });
  goToPage(n.page, n.box.y);
  toast(`Pinned as a note on page ${msg.page}`, "success");
}

export async function summarizeToNote(topicId: string) {
  const topic = get().nodes[topicId] as TopicNode | undefined;
  if (!topic) return;
  const leaf = activeLeafOf(get().nodes, topic);
  const history = threadTo(get().nodes, leaf).map((m) => ({ role: m.role, content: stripDemoBanner(m.content) }));
  if (!history.length) {
    toast("Ask something first, then summarise the discussion into a note.");
    return;
  }
  const note = addNote(topic.page, { content: "_Summarising…_", parentId: topicId, near: topic.anchor.rects[0], color: NOTE_COLORS[0] });
  goToPage(topic.page, note.box.y);
  try {
    let last = 0;
    const text = await streamChat(await payloadFor(topic, "note", history), (_d, all) => {
      if (Date.now() - last > 60) {
        last = Date.now();
        updateNote(note.id, { content: all }, false);
      }
    });
    updateNote(note.id, { content: text.trim() });
    toast("Discussion summarised into a note on the page", "success");
  } catch (e) {
    updateNote(note.id, { content: `Could not summarise: ${e instanceof Error ? e.message : e}` });
  }
}

// ------------------------------------------------------------------ selectors

export function topicPathIds(topicId: string): Set<string> {
  const nodes = get().nodes;
  const t = nodes[topicId] as TopicNode | undefined;
  if (!t) return new Set();
  return new Set(pathTo(nodes, activeLeafOf(nodes, t)).map((n) => n.id));
}

export function setFocusMsg(id: string | null) {
  set({ focusMsgId: id });
}
