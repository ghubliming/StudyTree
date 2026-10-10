import { describe, expect, it } from "vitest";
import {
  activeLeafOf, descendantIds, layoutTopicTree, leavesUnder, newestLeafUnder, pathTo, siblingInfo, threadTo, topicStats,
  type NodeMap,
} from "../src/lib/tree";
import { buildOutline, mdToPlain } from "../src/lib/outline";
import type { MessageNode, TopicNode } from "../src/lib/types";

let t = 0;
const topic: TopicNode = {
  id: "t", docId: "d", type: "topic", parentId: null, page: 1, title: "T", color: "#f5b700",
  anchor: { kind: "page", rects: [] }, createdAt: t++, updatedAt: 0,
};
const m = (id: string, parentId: string, role: "user" | "assistant"): MessageNode => ({
  id, docId: "d", type: "msg", parentId, topicId: "t", page: 1, role, content: id, createdAt: t++, updatedAt: 0,
});

// t ─ q1 ─ a1 ┬ q2 ─ a2
//             └ q3 ─ a3 ─ q4
const nodes: NodeMap = Object.fromEntries(
  [topic, m("q1", "t", "user"), m("a1", "q1", "assistant"), m("q2", "a1", "user"), m("a2", "q2", "assistant"),
    m("q3", "a1", "user"), m("a3", "q3", "assistant"), m("q4", "a3", "user")].map((n) => [n.id, n]),
);

describe("tree", () => {
  it("walks paths and threads", () => {
    expect(pathTo(nodes, "a2").map((n) => n.id)).toEqual(["t", "q1", "a1", "q2", "a2"]);
    expect(threadTo(nodes, "a2").map((n) => n.id)).toEqual(["q1", "a1", "q2", "a2"]);
  });
  it("finds leaves and newest leaf", () => {
    expect(leavesUnder(nodes, "t").map((n) => n.id).sort()).toEqual(["a2", "q4"]);
    expect(newestLeafUnder(nodes, "t")).toBe("q4");
  });
  it("resolves active leaf, repairing stale pointers", () => {
    expect(activeLeafOf(nodes, { ...topic, activeLeafId: "a2" })).toBe("a2");
    expect(activeLeafOf(nodes, { ...topic, activeLeafId: "missing" })).toBe("q4");
  });
  it("reports siblings and stats", () => {
    const info = siblingInfo(nodes, nodes.q3 as MessageNode);
    expect(info).toMatchObject({ index: 1, count: 2 });
    expect(topicStats(nodes, "t")).toEqual({ messages: 7, branches: 1, leaves: 2, depth: 5 });
    expect(descendantIds(nodes, "a1").sort()).toEqual(["a2", "a3", "q2", "q3", "q4"]);
  });
  it("lays out leaves in separate columns with parents centred", () => {
    const L = Object.fromEntries(layoutTopicTree(nodes, "t").map((n) => [n.id, n]));
    expect(L.a2.x).toBe(0);
    expect(L.q4.x).toBe(1);
    expect(L.a1.x).toBe(0.5);
    expect(L.q4.depth).toBe(5);
  });
  it("outlines forks as indented branches", () => {
    const kinds = buildOutline(nodes).map((i) => (i.kind === "msg" ? `${i.msg.id}@${i.indent}` : i.kind));
    expect(kinds).toEqual(["page", "topic", "q1@0", "a1@0", "branch", "q2@1", "a2@1", "branch", "q3@1", "a3@1", "q4@1"]);
  });
  it("flattens markdown for print", () => {
    expect(mdToPlain("## Hi\n**bold** and `code`\n- item")).toBe("Hi\nbold and code\n• item");
  });
});
