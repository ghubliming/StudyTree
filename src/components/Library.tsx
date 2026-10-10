import { useRef, useState } from "react";
import { ACCEPT, deleteDocument, importFile, openDoc, openSample, useStore } from "../store/useStore";
import { AiBadge, ThemeToggle } from "./Common";
import { Icon } from "./Icon";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Library() {
  const docs = useStore((s) => s.docs);
  const health = useStore((s) => s.health);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hasSample = docs.some((d) => d.id === "sample_neural_networks");

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) await importFile(f);
  };

  return (
    <div className="library">
      <header className="lib-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          StudyTree
        </div>
        <span className="spacer" />
        <AiBadge />
        <ThemeToggle />
      </header>
      <main className="lib-main">
        <section className="hero">
          <div>
            <h1>Study any textbook or slide deck with an AI tutor that keeps your thinking organised.</h1>
            <p>
              Highlight a passage or box a diagram, ask a question, and branch the discussion as far as you need. Every
              conversation lives on its page as a tree, and the best answers become notes pinned right on the page.
            </p>
            <ul className="hero-points">
              <li><Icon name="tree" /> <span><b>Tree-organised chat</b> — page → topic → branching threads, never a lost scroll.</span></li>
              <li><Icon name="note" /> <span><b>Notes on the page</b> — pin any answer as a comment box where it belongs.</span></li>
              <li><Icon name="download" /> <span><b>Export everything</b> — annotated PDF, Markdown, or a lossless study pack.</span></li>
            </ul>
          </div>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              onFiles(e.dataTransfer.files);
            }}
          >
            <Icon name="upload" size={30} />
            <div className="big">Drop a PDF, slide deck or study pack</div>
            <div className="formats">
              PDF · PPT/PPTX · Keynote · Word · <b>.studytree</b>
              {health && !health.convert && " (slides need LibreOffice on the server)"}
            </div>
            <button className="btn primary" type="button">
              <Icon name="file" /> Choose file
            </button>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
        </section>

        <h2 className="section-title">
          <Icon name="book" /> Your library <span className="muted" style={{ fontWeight: 400 }}>· stored privately in this browser</span>
        </h2>
        <div className="doc-grid">
          {!hasSample && (
            <div className="doc-card sample-card" onClick={() => openSample()} role="button" tabIndex={0}>
              <div className="doc-thumb">
                <Icon name="sparkle" size={40} />
              </div>
              <div className="meta">
                <div className="title">Try the sample: Chapter 3 — Neural Networks</div>
                <div className="sub">5 pages · 6 topics with branches · 4 notes</div>
              </div>
            </div>
          )}
          {docs.map((d) => (
            <div key={d.id} className="doc-card" onClick={() => openDoc(d.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openDoc(d.id)}>
              <div className="doc-thumb">{d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Icon name="file" size={40} />}</div>
              <div className="meta">
                <div className="title">{d.title}</div>
                <div className="sub">
                  {d.pageCount} pages · {d.sourceType.toUpperCase()} · {timeAgo(d.updatedAt)}
                </div>
              </div>
              <button
                className="btn sm icon del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete “${d.title}” and all its discussions from this browser?`)) deleteDocument(d.id);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        {docs.length === 0 && <p className="empty-lib">No documents yet — upload one or open the sample.</p>}

        <section className="how">
          <div>
            <span className="n">1</span>
            <h3>Open</h3>
            <p>Upload a PDF or slides. Pages render crisp, with selectable text.</p>
          </div>
          <div>
            <span className="n">2</span>
            <h3>Ask in context</h3>
            <p>Select text or box a figure, then ask. The tutor sees the page and your selection.</p>
          </div>
          <div>
            <span className="n">3</span>
            <h3>Branch &amp; organise</h3>
            <p>Fork any message to explore alternatives. The outline and map show the whole tree.</p>
          </div>
          <div>
            <span className="n">4</span>
            <h3>Keep it</h3>
            <p>Pin answers as notes, then export an annotated PDF or a lossless study pack.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
