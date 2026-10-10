import type { MessageNode, NoteNode, StudyNode, TopicNode } from "./types";

/** Pure helpers for navigating the discussion tree. No React, no storage. */

export type NodeMap = Record<string, StudyNode>;

export function childrenOf(nodes: NodeMap, parentId: string): StudyNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function messageChildren(nodes: NodeMap, parentId: string): MessageNode[] {
  return childrenOf(nodes, parentId).filter((n): n is MessageNode => n.type === "msg");
}

export function topicsOnPage(nodes: NodeMap, page: number): TopicNode[] {
  return Object.values(nodes)
    .filter((n): n is TopicNode => n.type === "topic" && n.page === page)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function allTopics(nodes: NodeMap): TopicNode[] {
  return Object.values(nodes)
    .filter((n): n is TopicNode => n.type === "topic")
    .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

export function notesOnPage(nodes: NodeMap, page: number): NoteNode[] {
  return Object.values(nodes)
    .filter((n): n is NoteNode => n.type === "note" && n.page === page)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Pages that carry any topic or note, ascending. */
export function pagesWithContent(nodes: NodeMap): number[] {
  const set = new Set<number>();
  for (const n of Object.values(nodes)) if (n.type !== "msg") set.add(n.page);
  return [...set].sort((a, b) => a - b);
}

/** Ancestors from the root down to (and including) `id`. */
export function pathTo(nodes: NodeMap, id: string): StudyNode[] {
  const out: StudyNode[] = [];
  let cur: StudyNode | undefined = nodes[id];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return out;
}

/** Messages on the path from a topic to `leafId` (topic excluded). */
export function threadTo(nodes: NodeMap, leafId: string): MessageNode[] {
  return pathTo(nodes, leafId).filter((n): n is MessageNode => n.type === "msg");
}

/** Follow the most recently created child until a leaf is reached. */
export function newestLeafUnder(nodes: NodeMap, id: string): string {
  let cur = id;
  for (;;) {
    const kids = messageChildren(nodes, cur);
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1].id;
  }
}

/** All message leaves (thread endings) under a node. */
export function leavesUnder(nodes: NodeMap, id: string): MessageNode[] {
  const kids = messageChildren(nodes, id);
  if (kids.length === 0) {
    const n = nodes[id];
    return n && n.type === "msg" ? [n] : [];
  }
  return kids.flatMap((k) => leavesUnder(nodes, k.id));
}

/** Every descendant id (any type), depth first. */
export function descendantIds(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf(nodes, cur)) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** Resolve which leaf a topic should display, repairing a stale pointer. */
export function activeLeafOf(nodes: NodeMap, topic: TopicNode): string {
  const want = topic.activeLeafId;
  if (want && nodes[want]) {
    const path = pathTo(nodes, want);
    if (path[0]?.id === topic.id) return want;
  }
  return newestLeafUnder(nodes, topic.id);
}

export interface SiblingInfo {
  index: number;
  count: number;
  siblings: MessageNode[];
}

export function siblingInfo(nodes: NodeMap, msg: MessageNode): SiblingInfo {
  const siblings = messageChildren(nodes, msg.parentId);
  return { index: siblings.findIndex((s) => s.id === msg.id), count: siblings.length, siblings };
}

export interface TopicStats {
  messages: number;
  branches: number;
  leaves: number;
  depth: number;
}

export function topicStats(nodes: NodeMap, topicId: string): TopicStats {
  let messages = 0;
  let branches = 0;
  let depth = 0;
  const walk = (id: string, d: number) => {
    const kids = messageChildren(nodes, id);
    if (kids.length > 1) branches += kids.length - 1;
    depth = Math.max(depth, d);
    for (const k of kids) {
      messages++;
      walk(k.id, d + 1);
    }
  };
  walk(topicId, 0);
  return { messages, branches, leaves: leavesUnder(nodes, topicId).length, depth };
}

/** Short single-line label for a node in outlines and maps. */
export function nodeLabel(n: StudyNode, max = 60): string {
  const raw =
    n.type === "topic" ? n.title : n.type === "note" ? n.content : (n.action ? `${n.action}: ` : "") + n.content;
  const flat = raw
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/\$\$[\s\S]*?\$\$/g, " [math] ")
    .replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/[#*_`>|$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat || "(empty)";
}

export interface TreeLayoutNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  node: StudyNode;
  parent?: string;
}

/**
 * Tidy layered layout for the topic map: each leaf gets its own column, parents
 * sit centred over their children. Returns positions in abstract grid units.
 */
export function layoutTopicTree(nodes: NodeMap, topicId: string): TreeLayoutNode[] {
  const out: TreeLayoutNode[] = [];
  let nextCol = 0;
  const place = (id: string, depth: number, parent?: string): number => {
    const kids = messageChildren(nodes, id);
    let x: number;
    if (kids.length === 0) {
      x = nextCol++;
    } else {
      const xs = kids.map((k) => place(k.id, depth + 1, id));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    out.push({ id, x, y: depth, depth, node: nodes[id], parent });
    return x;
  };
  if (nodes[topicId]) place(topicId, 0);
  return out;
}
