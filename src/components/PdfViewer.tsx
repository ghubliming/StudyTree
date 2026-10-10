import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { topicLabels } from "../lib/outline";
import { TextLayer } from "../lib/pdf";
import { notesOnPage, topicsOnPage } from "../lib/tree";
import type { Rect, TopicNode } from "../lib/types";
import {
  addNote, ask, createTopic, focusComposer, selectNote, selectTopic, setCurrentPage, setEditingNote, setTool, useStore,
} from "../store/useStore";
import { Icon } from "./Icon";
import { NoteBox } from "./NoteBox";

interface Size {
  w: number;
  h: number;
}

interface SelectionInfo {
  page: number;
  rects: Rect[];
  quote: string;
  x: number;
  y: number;
}

/** Merge per-glyph client rects into one rect per line, normalised to the page box. */
function selectionRects(range: Range, pageEl: HTMLElement): Rect[] {
  const box = pageEl.getBoundingClientRect();
  const raw = Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1)
    .filter((r) => r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: DOMRect[] = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    const sameLine = last && Math.abs(last.top + last.height / 2 - (r.top + r.height / 2)) < Math.max(4, r.height * 0.45);
    if (sameLine && r.left <= last.right + r.height * 2) {
      const left = Math.min(last.left, r.left);
      const top = Math.min(last.top, r.top);
      lines[lines.length - 1] = new DOMRect(left, top, Math.max(last.right, r.right) - left, Math.max(last.bottom, r.bottom) - top);
    } else lines.push(new DOMRect(r.left, r.top, r.width, r.height));
  }
  return lines.map((r) => ({
    x: Math.max(0, (r.left - box.left) / box.width),
    y: Math.max(0, (r.top - box.top) / box.height),
    w: Math.min(1, r.width / box.width),
    h: Math.min(1, r.height / box.height),
  }));
}

export function PdfViewer() {
  const pdf = useStore((s) => s.pdf);
  const doc = useStore((s) => s.doc);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const scrollTo = useStore((s) => s.scrollTo);
  const nodes = useStore((s) => s.nodes);
  const container = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [width, setWidth] = useState(800);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const labels = useMemo(() => topicLabels(nodes), [nodes]);

  // Page sizes (at scale 1, rotation applied) so every placeholder has the right height.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      const est = Array.from({ length: pdf.numPages }, () => ({ w: first.width, h: first.height }));
      if (!cancelled) setSizes(est);
      const out = [...est];
      for (let i = 2; i <= pdf.numPages; i++) {
        const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
        out[i - 1] = { w: vp.width, h: vp.height };
      }
      if (!cancelled) setSizes(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = sizes.reduce((m, s) => Math.max(m, s.w), 1);
  const fitWidth = Math.min(width - 40, 1000);
  const scale = Math.max(0.2, (fitWidth / maxW) * zoom);

  // Which pages are near the viewport (rendered) and which one is "current".
  useEffect(() => {
    const root = container.current;
    if (!root || !sizes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          return next;
        });
      },
      { root, rootMargin: "120% 0px" },
    );
    pageEls.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [sizes.length, scale]);

  const onScroll = useCallback(() => {
    const root = container.current;
    if (!root) return;
    setSel(null);
    const probe = root.scrollTop + root.clientHeight * 0.35;
    let cur = 1;
    pageEls.current.forEach((el, i) => {
      if (el && el.offsetTop <= probe) cur = i + 1;
    });
    setCurrentPage(cur);
  }, []);

  // Programmatic navigation.
  useEffect(() => {
    if (!scrollTo || !container.current) return;
    const el = pageEls.current[scrollTo.page - 1];
    if (!el) return;
    const y = el.offsetTop + (scrollTo.y ?? 0) * el.offsetHeight - (scrollTo.y ? container.current.clientHeight * 0.3 : 12);
    container.current.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }, [scrollTo, sizes.length]);

  // Keep the current page in view when zooming.
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    if (lastScale.current === scale || !container.current) return;
    const root = container.current;
    const ratio = scale / lastScale.current;
    root.scrollTop = root.scrollTop * ratio;
    lastScale.current = scale;
  }, [scale]);

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (useStore.getState().tool !== "select") return;
      const target = e.target as HTMLElement;
      if (target.closest(".note, .topic-badge, .sel-toolbar")) return;
      // Let the browser finish updating the selection.
      setTimeout(() => {
        const s = window.getSelection();
        const pageEl = (s?.anchorNode instanceof Element ? s.anchorNode : s?.anchorNode?.parentElement)?.closest<HTMLElement>(".page");
        if (s && !s.isCollapsed && pageEl && s.rangeCount) {
          const quote = s.toString().replace(/\s+/g, " ").trim();
          const range = s.getRangeAt(0);
          const rects = selectionRects(range, pageEl);
          if (quote && rects.length) {
            const b = range.getBoundingClientRect();
            setSel({ page: Number(pageEl.dataset.page), rects, quote, x: b.left + b.width / 2, y: b.top });
            return;
          }
        }
        setSel(null);
        // Plain click: select the topic whose highlight is under the pointer.
        const clickedPage = target.closest<HTMLElement>(".page");
        if (!clickedPage) return;
        const box = clickedPage.getBoundingClientRect();
        const px = (e.clientX - box.left) / box.width;
        const py = (e.clientY - box.top) / box.height;
        const page = Number(clickedPage.dataset.page);
        const hits = topicsOnPage(useStore.getState().nodes, page).filter((t) =>
          t.anchor.rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h),
        );
        if (hits.length) {
          const area = (t: TopicNode) => t.anchor.rects.reduce((a, r) => a + r.w * r.h, 0);
          selectTopic(hits.sort((a, b) => area(a) - area(b))[0].id);
        }
        selectNote(null);
      }, 0);
    },
    [],
  );

  const act = async (kind: "ask" | "explain" | "highlight" | "note") => {
    if (!sel) return;
    const { page, rects, quote } = sel;
    setSel(null);
    window.getSelection()?.removeAllRanges();
    if (kind === "note") {
      const n = addNote(page, { content: `> ${quote}\n\n`, near: rects[0] });
      setEditingNote(n.id);
      return;
    }
    const topic = await createTopic(page, { kind: "text", rects, quote });
    if (kind === "explain") ask(topic.id, "Explain this passage clearly, step by step.", { action: "Explain" });
    else if (kind === "ask") focusComposer();
  };

  if (!pdf || !doc) return <div className="viewer" ref={container} />;

  return (
    <div className={`viewer tool-${tool}`} ref={container} onScroll={onScroll} onMouseUp={onMouseUp}>
      <div className="pages">
        {sizes.map((s, i) => (
          <PageView
            key={i}
            pageNo={i + 1}
            size={s}
            scale={scale}
            render={visible.has(i + 1)}
            labels={labels}
            elRef={(el) => (pageEls.current[i] = el)}
          />
        ))}
      </div>
      {sel && (
        <div className="sel-toolbar" style={{ left: sel.x, top: Math.max(60, sel.y) }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => act("ask")}>
            <Icon name="chat" size={14} /> Ask AI
          </button>
          <button onClick={() => act("explain")}>
            <Icon name="sparkle" size={14} /> Explain
          </button>
          <button onClick={() => act("highlight")}>
            <Icon name="highlight" size={14} /> Highlight
          </button>
          <button onClick={() => act("note")}>
            <Icon name="note" size={14} /> Note
          </button>
        </div>
      )}
    </div>
  );
}

interface PageProps {
  pageNo: number;
  size: Size;
  scale: number;
  render: boolean;
  labels: Map<string, string>;
  elRef: (el: HTMLDivElement | null) => void;
}

const PageView = memo(function PageView({ pageNo, size, scale, render, labels, elRef }: PageProps) {
  const pdf = useStore((s) => s.pdf)!;
  const nodes = useStore((s) => s.nodes);
  const selectedTopicId = useStore((s) => s.selectedTopicId);
  const tool = useStore((s) => s.tool);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const w = Math.floor(size.w * scale);
  const h = Math.floor(size.h * scale);
  const topics = useMemo(() => topicsOnPage(nodes, pageNo), [nodes, pageNo]);
  const notes = useMemo(() => notesOnPage(nodes, pageNo), [nodes, pageNo]);

  useEffect(() => {
    if (!render) {
      setRendered(false);
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      if (textRef.current) textRef.current.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let textLayer: InstanceType<typeof TextLayer> | null = null;
    (async () => {
      const page = await pdf.getPage(pageNo);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;
      setRendered(true);
      const tl = textRef.current!;
      tl.replaceChildren();
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale }) });
      await textLayer.render().catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNo, scale, render]);

  return (
    <div
      className="page"
      data-page={pageNo}
      ref={elRef}
      style={{ width: w, height: h, ["--total-scale-factor" as string]: scale }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      {!rendered && <div className="page-loading">Page {pageNo}</div>}
      <div className="hl-layer">
        {topics.map((t) =>
          t.anchor.kind === "page"
            ? null
            : t.anchor.rects.map((r, i) => (
                <div
                  key={`${t.id}_${i}`}
                  className={`hl ${t.anchor.kind === "region" ? "region" : ""} ${t.id === selectedTopicId ? "sel" : ""}`}
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    background: `${t.color}${t.id === selectedTopicId ? "70" : "45"}`,
                    borderColor: t.color,
                    color: t.color,
                  }}
                />
              )),
        )}
      </div>
      <div className="textLayer" ref={textRef} />
      <div className="ui-layer">
        {topics.map((t, i) => {
          const r = t.anchor.rects[0] ?? { x: 0.04, y: 0.02 + i * 0.035, w: 0, h: 0 };
          const label = labels.get(t.id) ?? "T";
          const left = t.anchor.kind === "page" ? 0.035 : Math.max(0.035, r.x);
          return (
            <div
              key={t.id}
              className={`topic-badge ${t.id === selectedTopicId ? "sel" : ""}`}
              style={{ left: `${left * 100}%`, top: `${r.y * 100}%`, background: t.color, marginLeft: -3 }}
              title={`${label} · ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                selectTopic(t.id);
              }}
            >
              {label}
              {t.anchor.kind === "page" && <span className="n">· page</span>}
            </div>
          );
        })}
        {notes.map((n) => (
          <NoteBox key={n.id} note={n} pageW={w} pageH={h} />
        ))}
      </div>
      {tool !== "select" && <DrawLayer pageNo={pageNo} pageW={w} pageH={h} />}
      <span className="page-num">{pageNo}</span>
    </div>
  );
});

function DrawLayer({ pageNo, pageW, pageH }: { pageNo: number; pageW: number; pageH: number }) {
  const tool = useStore((s) => s.tool);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [done, setDone] = useState<Rect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const pt = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };

  const finish = () => {
    if (!rect) return;
    setDrag(null);
    const tiny = rect.w * pageW < 12 || rect.h * pageH < 12;
    if (tool === "note") {
      const box = tiny ? { x: Math.min(rect.x, 0.68), y: Math.min(rect.y, 0.86), w: 0.3, h: 0.12 } : rect;
      const n = addNote(pageNo, { box });
      setEditingNote(n.id);
      setTool("select");
      return;
    }
    if (tiny) return;
    setDone(rect);
  };

  const region = async (mode: "ask" | "explain" | "note") => {
    const r = done!;
    setDone(null);
    setTool("select");
    if (mode === "note") {
      const n = addNote(pageNo, { box: r });
      setEditingNote(n.id);
      return;
    }
    const t = await createTopic(pageNo, { kind: "region", rects: [r] });
    if (mode === "explain") ask(t.id, "Explain what this part of the page shows.", { action: "Explain" });
    else focusComposer();
  };

  const shown = done ?? rect;
  return (
    <div
      ref={ref}
      className="page-overlay-draw"
      onPointerDown={(e) => {
        if (done) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pt(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x1: p.x, y1: p.y }))(pt(e)) })}
      onPointerUp={finish}
    >
      {shown && (
        <div className="draw-rect" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />
      )}
      {done && (
        <div
          className="region-popup"
          style={{ left: `${done.x * 100}%`, top: `calc(${(done.y + done.h) * 100}% + 6px)` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => region("ask")}>Ask about region</button>
          <button onClick={() => region("explain")}>Explain</button>
          <button onClick={() => region("note")}>Note here</button>
          <button onClick={() => setDone(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
