/**
 * Data model.
 *
 * A study document is organised as a tree (think control-flow graph with leaves):
 *
 *   Document
 *   └── Page N                       (implicit: grouped by `page`)
 *       ├── Topic                    (a question area anchored to text or a region)
 *       │   └── Message ─┬─ Message  (discussion; any message can fork into branches)
 *       │                └─ Message  (… each branch ends in a leaf)
 *       └── Note                     (a comment box pinned directly on the page)
 *
 * All coordinates are normalised to the page box (0..1, origin top-left) so they
 * survive zooming and can be mapped back into PDF user space on export.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  kind: "text" | "region" | "page";
  rects: Rect[];
  /** Selected text for `text` anchors. */
  quote?: string;
}

export type NodeType = "topic" | "msg" | "note";
export type Role = "user" | "assistant";

interface NodeBase {
  id: string;
  docId: string;
  type: NodeType;
  /** null for root-level topics and page notes. */
  parentId: string | null;
  /** 1-based page number. */
  page: number;
  createdAt: number;
  updatedAt: number;
}

export interface TopicNode extends NodeBase {
  type: "topic";
  parentId: null;
  title: string;
  color: string;
  anchor: Anchor;
  /** The leaf currently shown in the discussion panel. */
  activeLeafId?: string;
  /** PNG data URL of a region anchor, sent to the tutor as an image. */
  snapshot?: string;
}

export interface MessageNode extends NodeBase {
  type: "msg";
  parentId: string;
  topicId: string;
  role: Role;
  content: string;
  status?: "streaming" | "error" | "done";
  /** Quick-action label that produced the prompt, e.g. "Explain simply". */
  action?: string;
}

export interface NoteNode extends NodeBase {
  type: "note";
  /** Topic the note belongs to, or null for a free page note. */
  parentId: string | null;
  box: Rect;
  content: string;
  color: string;
  /** Message this note was pinned from. */
  sourceId?: string;
  collapsed?: boolean;
}

export type StudyNode = TopicNode | MessageNode | NoteNode;

export interface DocMeta {
  id: string;
  title: string;
  fileName: string;
  /** Original upload type, e.g. "pdf", "pptx". The stored file is always a PDF. */
  sourceType: string;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  lastPage?: number;
  /** Small PNG data URL of page 1 for the library. */
  thumbnail?: string;
}

/** The portable study pack (.studytree) — full-fidelity, re-importable. */
export interface StudyPackManifest {
  format: "studytree";
  version: 1;
  exportedAt: string;
  app: string;
  doc: DocMeta;
  nodes: StudyNode[];
}

export const TOPIC_COLORS = ["#f5b700", "#2f5bea", "#18a058", "#d03050", "#8a4bd8", "#00a0b0"];
export const NOTE_COLORS = ["#fff4b8", "#dbeafe", "#dcfce7", "#fde2e7", "#ede4ff", "#d5f5f6"];

/** File extension of the lossless study pack. */
export const PACK_EXT = ".studytree";
/** Name of the study pack embedded inside exported PDFs. */
export const PACK_ATTACHMENT_NAME = "session.studytree";
