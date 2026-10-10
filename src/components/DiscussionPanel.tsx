import { useEffect, useMemo, useRef, useState } from "react";
import { topicLabels } from "../lib/outline";
import {
  activeLeafOf, messageChildren, nodeLabel, notesOnPage, siblingInfo, threadTo, topicStats, topicsOnPage,
} from "../lib/tree";
import { TOPIC_COLORS, type MessageNode, type TopicNode } from "../lib/types";
import {
  ask, createTopic, deleteNode, editQuestion, goToPage, pinMessageAsNote, recolorTopic, regenerate, renameTopic,
  selectTopic, setFocusMsg, setReplyTo, setRightTab, stopStreaming, summarizeToNote, switchBranch, toast, useStore,
} from "../store/useStore";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { TopicMap } from "./TopicMap";

const QUICK = [
  { label: "Explain simply", prompt: "Explain this in simpler terms, as if I'm new to the subject." },
  { label: "Give an example", prompt: "Give me a concrete example that illustrates this." },
  { label: "Quiz me", prompt: "Quiz me on this with one question at a time." },
  { label: "Key terms", prompt: "List the key terms here with a one-line definition each." },
  { label: "Why it matters", prompt: "Why does this matter, and how does it connect to the rest of the chapter?" },
];

export function DiscussionPanel() {
  const topicId = useStore((s) => s.selectedTopicId);
  const topic = useStore((s) => (topicId ? (s.nodes[topicId] as TopicNode | undefined) : undefined));
  const tab = useStore((s) => s.rightTab);
  if (!topic) return <PageOverview />;
  return (
    <div className="disc">
      <TopicHeader topic={topic} />
      <div className="tabs" role="tablist">
        <button className={tab === "thread" ? "on" : ""} onClick={() => setRightTab("thread")} role="tab">
          Discussion
        </button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setRightTab("map")} role="tab">
          Tree map
        </button>
      </div>
      {tab === "thread" ? <Thread topic={topic} /> : <TopicMap topic={topic} />}
      <QuickActions topic={topic} />
      <Composer topic={topic} />
    </div>
  );
}

function TopicHeader({ topic }: { topic: TopicNode }) {
  const nodes = useStore((s) => s.nodes);
  const [title, setTitle] = useState(topic.title);
  useEffect(() => setTitle(topic.title), [topic.title]);
  const stats = useMemo(() => topicStats(nodes, topic.id), [nodes, topic.id]);
  const label = useMemo(() => topicLabels(nodes).get(topic.id), [nodes, topic.id]);
  const cycleColor = () => recolorTopic(topic.id, TOPIC_COLORS[(TOPIC_COLORS.indexOf(topic.color) + 1) % TOPIC_COLORS.length]);
  return (
    <div className="disc-head">
      <div className="disc-title">
        <span className="dot" style={{ background: topic.color }} title="Change colour" onClick={cycleColor} />
        <input
          value={title}
          aria-label="Topic title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== topic.title && renameTopic(topic.id, title)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn ghost sm icon" title="Close topic" onClick={() => selectTopic(null)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="disc-sub">
        <b style={{ color: topic.color }}>{label}</b>
        <a onClick={() => goToPage(topic.page, topic.anchor.rects[0]?.y)}>Page {topic.page}</a>
        <span>· {stats.messages} msgs</span>
        <span>· {stats.leaves} {stats.leaves === 1 ? "ending" : "endings"}</span>
        {stats.branches > 0 && <span>· {stats.branches} {stats.branches === 1 ? "branch" : "branches"}</span>}
        <span className="spacer" />
        <button
          className="btn ghost sm danger"
          onClick={() => confirm(`Delete topic “${topic.title}” and its whole discussion?`) && deleteNode(topic.id)}
          title="Delete topic"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {topic.anchor.kind === "text" && topic.anchor.quote && (
        <blockquote className="quote" style={{ borderLeftColor: topic.color }}>
          {topic.anchor.quote}
        </blockquote>
      )}
      {topic.anchor.kind === "region" && topic.snapshot && <img className="snapshot" src={topic.snapshot} alt="Selected region" />}
      {topic.anchor.kind === "page" && <div className="quote" style={{ borderLeftColor: topic.color }}>About the whole page</div>}
    </div>
  );
}

function Thread({ topic }: { topic: TopicNode }) {
  const nodes = useStore((s) => s.nodes);
  const focusMsgId = useStore((s) => s.focusMsgId);
  const leaf = activeLeafOf(nodes, topic);
  const thread = useMemo(() => threadTo(nodes, leaf), [nodes, leaf]);
  const scroller = useRef<HTMLDivElement>(null);
  const lastLen = useRef(0);
  const streamingTail = thread[thread.length - 1]?.status === "streaming" ? thread[thread.length - 1].content.length : 0;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (focusMsgId) {
      el.querySelector(`[data-msg="${focusMsgId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      const t = setTimeout(() => setFocusMsg(null), 2200);
      return () => clearTimeout(t);
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (thread.length !== lastLen.current || nearBottom) el.scrollTop = el.scrollHeight;
    lastLen.current = thread.length;
  }, [thread.length, streamingTail, focusMsgId, topic.id]);

  if (!thread.length) {
    return (
      <div className="thread" ref={scroller}>
        <div className="empty-disc">
          <h3>Start the discussion</h3>
          <p className="muted">Ask anything about this {topic.anchor.kind === "region" ? "region" : topic.anchor.kind === "page" ? "page" : "passage"} below, or pick a quick action.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="thread" ref={scroller}>
      {thread.map((m) => (
        <MessageView key={m.id} msg={m} flash={m.id === focusMsgId} />
      ))}
    </div>
  );
}

function MessageView({ msg, flash }: { msg: MessageNode; flash: boolean }) {
  const nodes = useStore((s) => s.nodes);
  const info = siblingInfo(nodes, msg);
  const childCount = messageChildren(nodes, msg.id).length;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const streaming = msg.status === "streaming";

  return (
    <>
      <div className={`msg ${msg.role} ${msg.status === "error" ? "error" : ""} ${flash ? "flash" : ""}`} data-msg={msg.id}>
        <div className="msg-head">
          <span className="who">{msg.role === "user" ? "You" : "Tutor"}</span>
          {msg.action && <span className="act">{msg.action}</span>}
          {info.count > 1 && (
            <span className="branch-switch" title="Switch between branches at this point">
              <button onClick={() => switchBranch(msg.id, -1)} aria-label="Previous branch">‹</button>
              branch {info.index + 1}/{info.count}
              <button onClick={() => switchBranch(msg.id, 1)} aria-label="Next branch">›</button>
            </span>
          )}
          <span className="spacer" />
          {streaming && (
            <button className="btn ghost sm" onClick={() => stopStreaming(msg.id)}>
              <Icon name="stop" size={12} /> Stop
            </button>
          )}
        </div>
        {editing ? (
          <div>
            <textarea className="text" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="btn primary sm"
                onClick={() => {
                  setEditing(false);
                  if (draft.trim() && draft.trim() !== msg.content) editQuestion(msg.id, draft);
                }}
              >
                <Icon name="branch" size={13} /> Send as new branch
              </button>
              <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={`msg-body ${streaming ? "caret" : ""}`}>
            {msg.content ? <Markdown text={msg.content} /> : streaming ? <span className="muted">Thinking…</span> : null}
          </div>
        )}
        {!streaming && !editing && (
          <div className="msg-tools">
            {msg.role === "assistant" ? (
              <>
                <button className="btn ghost sm" onClick={() => pinMessageAsNote(msg.id)} title="Pin this answer as a note on the page">
                  <Icon name="pin" size={13} /> Pin as note
                </button>
                <button className="btn ghost sm" onClick={() => setReplyTo(msg.id)} title="Ask a follow-up that starts a new branch here">
                  <Icon name="branch" size={13} /> Branch here
                </button>
                <button className="btn ghost sm" onClick={() => regenerate(msg.id)} title="Generate an alternative answer (new branch)">
                  <Icon name="refresh" size={13} /> Retry
                </button>
                <button
                  className="btn ghost sm"
                  title="Copy"
                  onClick={() => navigator.clipboard?.writeText(msg.content).then(() => toast("Copied"))}
                >
                  <Icon name="copy" size={13} />
                </button>
              </>
            ) : (
              <button
                className="btn ghost sm"
                onClick={() => {
                  setDraft(msg.content);
                  setEditing(true);
                }}
                title="Edit the question — creates a new branch, the original stays"
              >
                <Icon name="edit" size={13} /> Edit &amp; branch
              </button>
            )}
            <button
              className="btn ghost sm danger"
              title="Delete this message and everything after it"
              onClick={() => confirm("Delete this message and all replies under it?") && deleteNode(msg.id)}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        )}
      </div>
      {childCount > 1 && <ForkMarker count={childCount} />}
    </>
  );
}

function ForkMarker({ count }: { count: number }) {
  return <div className="fork-marker">The discussion splits into {count} branches here — use ‹ › below to switch.</div>;
}

function QuickActions({ topic }: { topic: TopicNode }) {
  const busy = useStore((s) => {
    const leaf = activeLeafOf(s.nodes, topic);
    const n = s.nodes[leaf];
    return n?.type === "msg" && n.status === "streaming";
  });
  return (
    <div className="quick">
      {QUICK.map((q) => (
        <button key={q.label} className="chip" disabled={busy} onClick={() => ask(topic.id, q.prompt, { action: q.label })}>
          {q.label}
        </button>
      ))}
      <button className="chip" disabled={busy} onClick={() => summarizeToNote(topic.id)} title="Condense this discussion into a note pinned on the page">
        <Icon name="note" size={12} /> Summarise → note
      </button>
    </div>
  );
}

function Composer({ topic }: { topic: TopicNode }) {
  const replyTo = useStore((s) => s.replyTo);
  const replyNode = useStore((s) => (s.replyTo ? s.nodes[s.replyTo] : undefined));
  const nonce = useStore((s) => s.composerNonce);
  const busy = useStore((s) => {
    const n = s.nodes[activeLeafOf(s.nodes, topic)];
    return n?.type === "msg" && n.status === "streaming";
  });
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (nonce) ta.current?.focus();
  }, [nonce]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  const send = () => {
    if (!text.trim() || busy) return;
    ask(topic.id, text);
    setText("");
  };

  const forking = replyTo && replyNode && replyNode.type === "msg" && messageChildren(useStore.getState().nodes, replyTo).length > 0;
  return (
    <div className="composer">
      {replyTo && replyNode && (
        <div className="replying">
          <Icon name="branch" size={13} />
          <span>{forking ? "New branch from" : "Replying to"}: {nodeLabel(replyNode, 70)}</span>
          <button className="btn ghost sm icon" onClick={() => setReplyTo(null)} title="Cancel">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={busy ? "The tutor is answering…" : "Ask about this… (Enter to send, Shift+Enter for a new line)"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary icon" onClick={send} disabled={!text.trim() || busy} title="Send">
          <Icon name="send" />
        </button>
      </div>
    </div>
  );
}

function PageOverview() {
  const page = useStore((s) => s.currentPage);
  const nodes = useStore((s) => s.nodes);
  const topics = useMemo(() => topicsOnPage(nodes, page), [nodes, page]);
  const notes = useMemo(() => notesOnPage(nodes, page), [nodes, page]);
  const labels = useMemo(() => topicLabels(nodes), [nodes]);
  return (
    <div className="disc">
      <div className="panel-head">
        <h2>Page {page}</h2>
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => createTopic(page, { kind: "page", rects: [] })}>
          <Icon name="chat" size={13} /> Ask about this page
        </button>
      </div>
      <div className="thread">
        {topics.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>TOPICS ON THIS PAGE</div>
            <div className="page-topics">
              {topics.map((t) => {
                const s = topicStats(nodes, t.id);
                return (
                  <div key={t.id} className="page-topic" onClick={() => selectTopic(t.id)}>
                    <span className="o-dot" style={{ background: t.color }} />
                    <b style={{ fontSize: 11, color: t.color }}>{labels.get(t.id)}</b>
                    <span className="t">{t.title}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{s.messages} msgs{s.branches ? ` · ${s.branches + 1} br` : ""}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {notes.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            📝 {notes.length} note{notes.length === 1 ? "" : "s"} pinned on this page
          </div>
        )}
        <div className="empty-disc" style={{ padding: 0 }}>
          <h3>{topics.length ? "Start another topic" : "Nothing discussed on this page yet"}</h3>
          <ol>
            <li><b>Select text</b> on the page, then choose <i>Ask AI</i>, <i>Explain</i>, <i>Highlight</i> or <i>Note</i>.</li>
            <li>Use the <b>Region</b> tool <span className="kbd">R</span> to box a diagram, table or formula.</li>
            <li>Use the <b>Note</b> tool <span className="kbd">N</span> to stick a comment anywhere.</li>
            <li>Every answer can be <b>branched</b>, <b>retried</b> or <b>pinned as a note</b>.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
