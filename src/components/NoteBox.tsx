import { memo, useEffect, useRef, useState } from "react";
import { NOTE_COLORS, type NoteNode, type Rect } from "../lib/types";
import { deleteNode, selectNote, selectTopic, setEditingNote, updateNote, useStore } from "../store/useStore";
import { Markdown } from "./Markdown";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A comment box pinned on the page: drag by its header, resize from the corner, double-click to edit. */
export const NoteBox = memo(function NoteBox({ note, pageW, pageH }: { note: NoteNode; pageW: number; pageH: number }) {
  const editing = useStore((s) => s.editingNoteId === note.id);
  const selected = useStore((s) => s.selectedNoteId === note.id);
  const label = useStore((s) => {
    const t = note.parentId ? s.nodes[note.parentId] : undefined;
    return t && t.type === "topic" ? t.title : "Note";
  });
  const [box, setBox] = useState<Rect>(note.box);
  const [draft, setDraft] = useState(note.content);
  const [showColors, setShowColors] = useState(false);
  const drag = useRef<{ mode: "move" | "size"; sx: number; sy: number; start: Rect } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setBox(note.box), [note.box]);
  useEffect(() => {
    if (!editing) setDraft(note.content);
  }, [note.content, editing]);
  useEffect(() => {
    if (editing) {
      setDraft(note.content);
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(ta.current.value.length, ta.current.value.length);
      });
    }
    // Only when entering edit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const onDown = (mode: "move" | "size") => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: box };
    selectNote(note.id);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / pageW;
    const dy = (e.clientY - d.sy) / pageH;
    if (d.mode === "move") {
      setBox({ ...d.start, x: clamp(d.start.x + dx, 0, 1 - d.start.w), y: clamp(d.start.y + dy, 0, 1 - d.start.h) });
    } else {
      setBox({ ...d.start, w: clamp(d.start.w + dx, 0.08, 1 - d.start.x), h: clamp(d.start.h + dy, 0.04, 1 - d.start.y) });
    }
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (box.x !== note.box.x || box.y !== note.box.y || box.w !== note.box.w || box.h !== note.box.h) updateNote(note.id, { box });
  };
  const commit = () => {
    if (draft !== note.content) updateNote(note.id, { content: draft });
    setEditingNote(null);
  };

  if (note.collapsed) {
    return (
      <div
        className="note collapsed"
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, background: note.color }}
        title={note.content.slice(0, 200)}
        onClick={(e) => {
          e.stopPropagation();
          updateNote(note.id, { collapsed: false });
        }}
      >
        📝
      </div>
    );
  }

  return (
    <div
      className={`note ${selected ? "sel" : ""}`}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, background: note.color }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={() => selectNote(note.id)}
    >
      <div className="note-head" onPointerDown={onDown("move")} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="t" title={label}>📝 {label}</span>
        {showColors && (
          <span className="note-colors">
            {NOTE_COLORS.map((c) => (
              <span
                key={c}
                style={{ background: c }}
                onClick={() => {
                  updateNote(note.id, { color: c });
                  setShowColors(false);
                }}
              />
            ))}
          </span>
        )}
        <button title="Colour" onClick={() => setShowColors((v) => !v)}>●</button>
        {note.parentId && (
          <button title="Open the discussion" onClick={() => selectTopic(note.parentId)}>
            💬
          </button>
        )}
        <button title={editing ? "Done" : "Edit"} onClick={() => (editing ? commit() : setEditingNote(note.id))}>
          {editing ? "✓" : "✎"}
        </button>
        <button title="Minimise" onClick={() => updateNote(note.id, { collapsed: true })}>
          –
        </button>
        <button
          title="Delete note"
          onClick={() => {
            if (!note.content.trim() || confirm("Delete this note?")) deleteNode(note.id);
          }}
        >
          ×
        </button>
      </div>
      <div className="note-body" onDoubleClick={() => !editing && setEditingNote(note.id)}>
        {editing ? (
          <textarea
            ref={ta}
            value={draft}
            placeholder="Write a note… (Markdown and $math$ supported)"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                commit();
              }
            }}
          />
        ) : note.content.trim() ? (
          <Markdown text={note.content} />
        ) : (
          <span style={{ color: "#8a7f5a" }}>Double-click to write…</span>
        )}
      </div>
      <div className="note-resize" onPointerDown={onDown("size")} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
});
