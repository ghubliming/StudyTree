# StudyTree — learn textbooks & slides with an AI tutor

StudyTree turns a PDF textbook or a lecture deck into a study workspace. Learners highlight a passage or box a
diagram, ask an AI tutor about it, and **branch** the discussion as far as they need. Every conversation is
organised as a **tree** that hangs off the page it is about, and good answers become **notes pinned directly on the
page**. Everything exports to an annotated PDF or to a lossless study pack.

```
Document
└── Page 3                                   ← main: the PDF page
    ├── T5 · "Choosing the learning rate"    ← topic: highlighted text, a boxed region, or the whole page
    │   └── You ─ Tutor ─┬─ You ─ Tutor      ← sub: the discussion; any message can fork…
    │                    └─ You ─ Tutor      ← …and each branch ends in a leaf
    └── 📝 Note                               ← comment box pinned on the page
```

## Features

| | |
|---|---|
| **PDF & slides** | PDF renders crisp with selectable text. PPT/PPTX/Keynote/ODP/Word are converted to PDF on the server (LibreOffice). |
| **Ask in context** | Select text → *Ask AI / Explain / Highlight / Note*. **Region** tool (R) boxes a diagram, formula or table and sends an image of it to the tutor. *Ask about this page* for whole-page questions. |
| **Tree-organised chat** | Page → topic → threads. *Branch here*, *Edit & branch* and *Retry* fork the conversation instead of overwriting it; ‹ › switches branches. |
| **Study tree outline** | Left panel lists every page, topic and thread ending (leaf), with search. |
| **Tree map** | A graph view of each topic's discussion with the current path and leaves highlighted. Click any node to jump there. |
| **Notes on the page** | Pin any answer as a note, *Summarise → note* condenses a whole discussion, or use the **Note** tool (N). Notes are draggable, resizable, colourable, collapsible and support Markdown + maths. |
| **AI tutor** | Claude (`claude-opus-5-5` by default), streaming, grounded in the page text plus neighbouring pages; KaTeX maths; quick actions (Explain simply, Example, Quiz me, Key terms, Why it matters). Topics auto-title themselves. |
| **Export** | **Annotated PDF** (highlights, badges, note boxes, real PDF comments, linked study-notes appendix with every branch, embedded session) · **Study pack `.studytree`** (lossless) · **Markdown**. |
| **Re-open anywhere** | Importing an exported annotated PDF or a `.studytree` pack restores every topic, branch and note. |
| **Private by default** | Documents and discussions are stored in the browser (IndexedDB). The server only relays tutor requests and converts slides. |
| **Demo mode** | With no API key, a built-in demo tutor answers from the page text so the product can be shown offline. |

## Quick start

Requires Node.js 20+.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY for live AI (optional)
npm run dev                   # web on http://localhost:5173, API on :8787
```

Production build:

```bash
npm run build
npm start                     # serves the app and API on http://localhost:8787
```

Docker (includes LibreOffice for slide conversion):

```bash
docker compose up --build     # reads ANTHROPIC_API_KEY from your shell or .env
```

### Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables the live tutor. Without it the demo tutor is used. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model for tutoring. |
| `CLAUDE_EFFORT` | `medium` | `low` · `medium` · `high` · `xhigh` · `max` — depth vs. speed/cost of chat answers. Titles and note summaries always use `low`. |
| `PORT` | `8787` | HTTP port. |
| `APP_PASSWORD` | — | If set, the whole app asks for this password (HTTP Basic, any username). Recommended for public demo deployments. |
| `SOFFICE_PATH` | auto | Path to LibreOffice's `soffice` if it is not on `PATH`. |

The server enables Claude's server-side refusal fallback on supported models and caches the tutor's system prompt.

## Customer demo script (5 minutes)

1. **Library** → *Try the sample: Chapter 3 — Neural Networks*. It opens with six topics, branches and notes already
   in place.
2. **Show the tree**: the left panel is the study tree (page → topic → thread endings). Click **T1**: the discussion
   opens on the right; the badge **branch 2/2** shows the conversation forked into *Explain simply* and *Give an example*.
3. **Tree map** tab: the same discussion as a graph; click the *Explain simply* leaf to switch to that branch.
4. **Ask live**: type a follow-up, or select a sentence on the page → **Explain**. A new topic appears with its own
   highlight and badge.
5. **Region**: press **R**, box Figure 3.1 on page 2 → *Ask about region* → "How many weights are there?".
6. **Notes**: on any answer click **Pin as note** (it lands on the page next to the passage); or **Summarise → note**.
   Drag/resize the note.
7. **Export** → *Annotated PDF*. Open it in any PDF reader: highlights, T-badges that link to the study-notes appendix,
   note boxes and comments. Then drag that PDF back into StudyTree — the whole session is restored.
8. Upload a **PowerPoint** to show slide support.

## Saving: why three formats

A PDF can only show so much on a page, so StudyTree saves in layers:

1. **Annotated PDF** (for sharing / printing). On the pages: translucent highlights, coloured topic badges (T1, T2 …),
   note boxes, and standard PDF comment annotations holding each topic's thread and each note's full text. After the
   original pages, a **Study notes appendix** prints every topic's complete discussion tree, with branches marked; badges
   link into it and its headings link back. The `.studytree` pack is **embedded as a PDF attachment**, so the PDF itself
   can be re-imported without loss.
2. **Study pack `.studytree`** (the advanced, lossless format). A ZIP containing `manifest.json` (format, version,
   document metadata and every node with its position), the original `document.pdf`, and a readable `notes.md`.
   It has no limit on the number or length of comments and branches.
3. **Markdown** for Notion, Obsidian or a wiki.

## Architecture

```
server/            Express API (Node, TypeScript)
  index.ts         /api/health, /api/chat (SSE streaming), /api/convert (LibreOffice), static hosting
  tutor.ts         Claude prompt building + streaming, demo tutor
src/               React 19 + Vite web app
  lib/types.ts     data model (topics, messages, notes; normalised page coordinates)
  lib/tree.ts      pure tree operations: paths, leaves, branches, layout for the tree map
  lib/outline.ts   linearises the tree for print (Markdown / PDF appendix)
  lib/pdf.ts       pdf.js loading, text extraction, region crops, attachment reading
  lib/exportPdf.ts annotated PDF (pdf-lib): highlights, notes, comments, links, appendix, attachment
  lib/pack.ts      .studytree pack read/write
  lib/db.ts        IndexedDB persistence
  store/           application state and actions (zustand)
  components/      Library, Workspace, PdfViewer, NoteBox, OutlinePanel, DiscussionPanel, TopicMap, ExportDialog
scripts/           sample-content generator, browser smoke test
tests/             unit tests (tree logic, pack round-trip, PDF export)
```

All anchors are stored in normalised page coordinates (0–1, top-left origin), so they survive zoom and are mapped back
to PDF user space (CropBox and page rotation aware) on export.

## Quality checks

```bash
npm run typecheck
npm test                      # unit tests
npm run build && npm start &  # then:
npm run smoke                 # browser walkthrough; CHROME_PATH=/path/to/chrome if Chrome isn't installed
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push.

## Known limits / roadmap

- Storage is per browser. Use the study pack to move between devices; accounts and cloud sync are the next step.
- Text drawn into the exported PDF uses DejaVu Sans (Latin, Greek, Cyrillic, maths symbols). CJK text is complete in
  the PDF comments, the embedded pack and Markdown, but is replaced by `?` in drawn note boxes and the appendix until a
  CJK font is bundled.
- Scanned PDFs without a text layer work with the Region tool (the tutor sees the image); OCR is not built in.
- Very large documents (500+ pages) load page sizes progressively; rendering is lazy.

## Licence notes

`public/fonts/` contains DejaVu Sans (free licence, see `public/fonts/LICENSE-DejaVu.txt`), used only for PDF export.
