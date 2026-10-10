import { useEffect, useState } from "react";
import {
  closeDoc, goToPage, setShowExport, setTool, setZoom, toggleLeft, toggleRight, useStore,
} from "../store/useStore";
import { AiBadge, ThemeToggle } from "./Common";
import { DiscussionPanel } from "./DiscussionPanel";
import { ExportDialog } from "./ExportDialog";
import { Icon } from "./Icon";
import { OutlinePanel } from "./OutlinePanel";
import { PdfViewer } from "./PdfViewer";

function PageJump() {
  const current = useStore((s) => s.currentPage);
  const total = useStore((s) => s.doc?.pageCount ?? 1);
  const [val, setVal] = useState(String(current));
  useEffect(() => setVal(String(current)), [current]);
  return (
    <div className="pageinfo">
      <button className="btn ghost sm icon" onClick={() => goToPage(current - 1)} disabled={current <= 1} title="Previous page">
        <Icon name="left" />
      </button>
      <input
        aria-label="Page number"
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && goToPage(Number(val) || 1)}
        onBlur={() => setVal(String(current))}
      />
      <span>/ {total}</span>
      <button className="btn ghost sm icon" onClick={() => goToPage(current + 1)} disabled={current >= total} title="Next page">
        <Icon name="right" />
      </button>
    </div>
  );
}

export function Workspace() {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const showExport = useStore((s) => s.showExport);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("textarea, input") || e.target.isContentEditable);
      if (e.key === "Escape") setTool("select");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r") setTool("region");
      else if (e.key === "n") setTool("note");
      else if (e.key === "v") setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!doc) return null;
  return (
    <div className="workspace">
      <div className="topbar">
        <button className="btn ghost icon" onClick={closeDoc} title="Back to library">
          <Icon name="back" />
        </button>
        <button className={`btn ghost icon ${leftOpen ? "active" : ""}`} onClick={toggleLeft} title="Study tree outline">
          <Icon name="sidebar" />
        </button>
        <span className="doc-title" title={doc.title}>{doc.title}</span>
        <span className="spacer" />
        <div className="seg" role="toolbar" aria-label="Tools">
          <button className={`btn ${tool === "select" ? "active" : ""}`} onClick={() => setTool("select")} title="Select text to ask or highlight (V)">
            <Icon name="cursor" /> <span className="hide-sm">Select</span>
          </button>
          <button className={`btn ${tool === "region" ? "active" : ""}`} onClick={() => setTool("region")} title="Box a diagram, formula or table to ask about it (R)">
            <Icon name="region" /> <span className="hide-sm">Region</span>
          </button>
          <button className={`btn ${tool === "note" ? "active" : ""}`} onClick={() => setTool("note")} title="Click the page to add a note (N)">
            <Icon name="note" /> <span className="hide-sm">Note</span>
          </button>
        </div>
        <span className="spacer" />
        <PageJump />
        <div className="seg hide-sm">
          <button className="btn icon" onClick={() => setZoom(zoom - 0.1)} title="Zoom out">
            <Icon name="zoomOut" />
          </button>
          <button className="btn" onClick={() => setZoom(1)} title="Fit width" style={{ minWidth: 52 }}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="btn icon" onClick={() => setZoom(zoom + 0.1)} title="Zoom in">
            <Icon name="zoomIn" />
          </button>
        </div>
        <span className="hide-sm"><AiBadge /></span>
        <ThemeToggle />
        <button className="btn primary" onClick={() => setShowExport(true)}>
          <Icon name="download" /> <span className="hide-sm">Export</span>
        </button>
        <button className={`btn ghost icon ${rightOpen ? "active" : ""}`} onClick={toggleRight} title="Discussion panel">
          <Icon name="sidebarR" />
        </button>
      </div>
      <div className={`ws-body ${leftOpen ? "" : "no-left"} ${rightOpen ? "" : "no-right"}`}>
        <aside className="panel left">{leftOpen && <OutlinePanel />}</aside>
        <PdfViewer />
        <aside className="panel right">{rightOpen && <DiscussionPanel />}</aside>
      </div>
      {showExport && <ExportDialog />}
    </div>
  );
}
