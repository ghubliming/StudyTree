import { allTopics, messageChildren, notesOnPage, pagesWithContent, type NodeMap } from "./tree";
import type { MessageNode, NoteNode, TopicNode } from "./types";

/**
 * Linearises the study tree for printing (Markdown, PDF appendix).
 * Straight runs of a thread stay at one level; only forks indent, so a long
 * single-branch conversation reads like a chat while branches stay visible.
 */

export type OutlineItem =
  | { kind: "page"; page: number }
  | { kind: "topic"; topic: TopicNode; label: string }
  | { kind: "msg"; msg: MessageNode; indent: number }
  | { kind: "branch"; index: number; count: number; indent: number; leaf: boolean }
  | { kind: "note"; note: NoteNode; label: string };

export function topicLabels(nodes: NodeMap): Map<string, string> {
  const m = new Map<string, string>();
  allTopics(nodes).forEach((t, i) => m.set(t.id, `T${i + 1}`));
  return m;
}

export function noteLabels(nodes: NodeMap): Map<string, string> {
  const m = new Map<string, string>();
  const notes = Object.values(nodes)
    .filter((n): n is NoteNode => n.type === "note")
    .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  notes.forEach((n, i) => m.set(n.id, `N${i + 1}`));
  return m;
}

function walkChain(nodes: NodeMap, fromId: string, indent: number, out: OutlineItem[]) {
  let kids = messageChildren(nodes, fromId);
  while (kids.length === 1) {
    out.push({ kind: "msg", msg: kids[0], indent });
    kids = messageChildren(nodes, kids[0].id);
  }
  if (kids.length > 1) {
    kids.forEach((k, i) => {
      const leaf = messageChildren(nodes, k.id).length === 0;
      out.push({ kind: "branch", index: i + 1, count: kids.length, indent, leaf });
      out.push({ kind: "msg", msg: k, indent: indent + 1 });
      walkChain(nodes, k.id, indent + 1, out);
    });
  }
}

export function buildOutline(nodes: NodeMap): OutlineItem[] {
  const out: OutlineItem[] = [];
  const tl = topicLabels(nodes);
  const nl = noteLabels(nodes);
  const topics = allTopics(nodes);
  for (const page of pagesWithContent(nodes)) {
    out.push({ kind: "page", page });
    for (const t of topics.filter((x) => x.page === page)) {
      out.push({ kind: "topic", topic: t, label: tl.get(t.id)! });
      walkChain(nodes, t.id, 0, out);
    }
    for (const n of notesOnPage(nodes, page)) out.push({ kind: "note", note: n, label: nl.get(n.id)! });
  }
  return out;
}

const LATEX_SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", approx: "≈", neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥",
  infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫", sqrt: "√", to: "→", rightarrow: "→",
  leftarrow: "←", Rightarrow: "⇒", in: "∈", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ",
  epsilon: "ε", varepsilon: "ε", eta: "η", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ",
  Sigma: "Σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω", Omega: "Ω", ldots: "…", dots: "…", quad: "  ",
};

/** Best-effort LaTeX → readable Unicode for print (the app itself renders KaTeX). */
export function latexToText(src: string): string {
  let s = src;
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, "$1")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  }
  s = s
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => LATEX_SYMBOLS[name] ?? m.slice(1))
    .replace(/\^\{([^{}]*)\}/g, "^($1)")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/\\[,;!: ]/g, " ")
    .replace(/[{}]/g, "");
  return s;
}

/** Markdown → readable plain text for PDF output. */
export function mdToPlain(md: string): string {
  return md
    .replace(/\r/g, "")
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => `\n    ${latexToText(tex.trim())}\n`)
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => latexToText(tex))
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, "$1")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/^\s*\|(.*)\|\s*$/gm, (_m, row: string) => row.split("|").map((c) => c.trim()).join("  |  "))
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,:;!?]|$)/gm, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
