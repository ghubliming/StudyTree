import { useMemo, useState } from "react";
import { topicLabels } from "../lib/outline";
import {
  activeLeafOf, leavesUnder, nodeLabel, notesOnPage, pagesWithContent, threadTo, topicStats, topicsOnPage, type NodeMap,
} from "../lib/tree";
import type { StudyNode, TopicNode } from "../lib/types";
import { goToPage, selectNote, selectTopic, setActiveLeaf, setRightTab, useStore } from "../store/useStore";

function matches(nodes: NodeMap, t: TopicNode, q: string): boolean {
  if (!q) return true;
  const hay = [t.title, t.anchor.quote ?? "", ...Object.values(nodes).filter((n) => n.type === "msg" && n.topicId === t.id).map((n) => (n as { content: string }).content)]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** The study tree: Page → Topic → thread endings (leaves), plus page notes. */
export function OutlinePanel() {
  const nodes = useStore((s) => s.nodes);
  const currentPage = useStore((s) => s.currentPage);
  const selectedTopicId = useStore((s) => s.selectedTopicId);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const labels = useMemo(() => topicLabels(nodes), [nodes]);
  const query = q.trim().toLowerCase();
  const pages = pagesWithContent(nodes);
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const counts = useMemo(() => {
    let topics = 0, msgs = 0, notes = 0;
    for (const n of Object.values(nodes)) {
      if (n.type === "topic") topics++;
      else if (n.type === "msg") msgs++;
      else notes++;
    }
    return { topics, msgs, notes };
  }, [nodes]);

  return (
    <>
      <div className="panel-head">
        <h2>Study tree</h2>
      </div>
      <div className="panel-body">
        <div className="outline">
          <input className="text search" placeholder="Search topics and answers…" value={q} onChange={(e) => setQ(e.target.value)} />
          {pages.length === 0 && (
            <div className="o-empty">
              Your discussions will appear here as a tree: <b>page → topic → branches</b>. Select text on the page to start.
            </div>
          )}
          {pages.map((page) => {
            const topics = topicsOnPage(nodes, page).filter((t) => matches(nodes, t, query));
            const notes = notesOnPage(nodes, page).filter((n) => !query || n.content.toLowerCase().includes(query));
            if (query && !topics.length && !notes.length) return null;
            const key = `p${page}`;
            const open = !collapsed.has(key);
            return (
              <div key={page} className="o-page">
                <div className={`o-row page ${page === currentPage ? "current" : ""}`} onClick={() => goToPage(page)}>
                  <span
                    className="twisty"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(key);
                    }}
                  >
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="lbl">Page {page}</span>
                  <span className="cnt">
                    {topics.length ? `${topics.length} topic${topics.length === 1 ? "" : "s"}` : ""}
                    {notes.length ? ` · ${notes.length}📝` : ""}
                  </span>
                </div>
                {open && (
                  <div className="o-children">
                    {topics.map((t) => (
                      <TopicRow
                        key={t.id}
                        topic={t}
                        label={labels.get(t.id)!}
                        nodes={nodes}
                        selected={t.id === selectedTopicId}
                        open={!collapsed.has(t.id)}
                        onToggle={() => toggle(t.id)}
                      />
                    ))}
                    {notes.map((n) => (
                      <div
                        key={n.id}
                        className="o-row o-leaf"
                        onClick={() => {
                          selectNote(n.id);
                          goToPage(n.page, n.box.y);
                        }}
                        title={n.content}
                      >
                        <span className="twisty">📝</span>
                        <span className="lbl">{nodeLabel(n as StudyNode, 48)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="o-stats">
        <span>{counts.topics} topics</span>
        <span>{counts.msgs} messages</span>
        <span>{counts.notes} notes</span>
      </div>
    </>
  );
}

function TopicRow({
  topic, label, nodes, selected, open, onToggle,
}: { topic: TopicNode; label: string; nodes: NodeMap; selected: boolean; open: boolean; onToggle: () => void }) {
  const stats = topicStats(nodes, topic.id);
  const leaves = leavesUnder(nodes, topic.id);
  const activeLeaf = activeLeafOf(nodes, topic);
  const showLeaves = leaves.length > 1;
  return (
    <>
      <div className={`o-row ${selected ? "sel" : ""}`} onClick={() => selectTopic(topic.id, { scroll: true, tab: "thread" })} title={topic.title}>
        <span
          className="twisty"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {showLeaves ? (open ? "▾" : "▸") : ""}
        </span>
        <span className="o-dot" style={{ background: topic.color }} />
        <span className="lbl">
          <b style={{ color: topic.color, fontSize: 11 }}>{label}</b> {topic.title}
        </span>
        <span className="cnt">{stats.messages}</span>
      </div>
      {showLeaves && open && (
        <div className="o-children">
          {leaves.map((leaf, i) => {
            // Label a thread ending by its last question.
            const lastQ = [...threadTo(nodes, leaf.id)].reverse().find((m) => m.role === "user");
            return (
              <div
                key={leaf.id}
                className={`o-row o-leaf ${leaf.id === activeLeaf ? "active" : ""}`}
                onClick={() => {
                  selectTopic(topic.id, { scroll: true });
                  setActiveLeaf(topic.id, leaf.id);
                  setRightTab("thread");
                }}
                title={lastQ?.content}
              >
                <span className="twisty" />
                <span className="leaf-ic" />
                <span className="lbl">{lastQ ? nodeLabel(lastQ, 44) : `Branch ${i + 1}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
