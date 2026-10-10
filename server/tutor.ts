import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type TutorMode = "chat" | "note" | "title";

export interface ChatRequest {
  mode: TutorMode;
  docTitle: string;
  page: number;
  pageCount: number;
  pageText: string;
  /** Text of the neighbouring pages, for continuity. */
  contextText?: string;
  anchor?: { kind: "text" | "region" | "page"; quote?: string };
  topicTitle?: string;
  /** PNG data URL of a selected region (diagram, formula, chart). */
  image?: string;
  history: { role: "user" | "assistant"; content: string }[];
  language?: string;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT || "medium") as Effort;
// Server-side refusal fallback is accepted on these models only.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function isLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// Kept byte-stable so it is served from the prompt cache across requests.
const SYSTEM = `You are StudyTree, a patient, precise tutor that helps a learner study a textbook or lecture slides.

The learner reads a document page by page. Every question belongs to one page and one topic on that page (a highlighted passage, a selected region such as a diagram, or the whole page). You receive that page's text, sometimes neighbouring pages and an image of the selected region.

How to answer:
- Ground answers in the provided page content. When you go beyond it, say so briefly ("Beyond this page: …").
- Teach, don't just tell: start with the core idea in one or two sentences, then build up with structure, an example or analogy where it helps.
- Use Markdown: short paragraphs, bullet lists, **bold** for key terms. Use LaTeX for maths ($inline$ and $$display$$).
- Keep answers focused, usually under 250 words unless the learner asks for depth.
- When asked to quiz, ask one question at a time and wait for the answer before revealing it.
- Reply in the learner's language.`;

function contextBlock(req: ChatRequest): string {
  const parts = [
    `<document title="${escapeAttr(req.docTitle)}" page="${req.page}" of="${req.pageCount}">`,
    `<page_text>\n${req.pageText || "(no extractable text on this page — it may be a scanned image or a figure)"}\n</page_text>`,
  ];
  if (req.contextText) parts.push(`<neighbouring_pages>\n${req.contextText}\n</neighbouring_pages>`);
  parts.push(`</document>`);
  if (req.topicTitle) parts.push(`Topic: ${req.topicTitle}`);
  if (req.anchor?.kind === "text" && req.anchor.quote) {
    parts.push(`The learner highlighted this passage:\n<highlight>\n${req.anchor.quote}\n</highlight>`);
  } else if (req.anchor?.kind === "region") {
    parts.push("The learner selected a region of the page; it is attached as an image.");
  } else {
    parts.push("The learner is asking about the page as a whole.");
  }
  return parts.join("\n\n");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'");
}

function parseDataUrl(url: string): { media_type: "image/png" | "image/jpeg"; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url);
  return m ? { media_type: m[1] as "image/png" | "image/jpeg", data: m[2] } : null;
}

function buildMessages(req: ChatRequest): BetaMessageParam[] {
  const history = req.history.filter((m) => m.content.trim().length > 0);
  if (req.mode === "note" || req.mode === "title") {
    const transcript = history.map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content}`).join("\n\n");
    const instruction =
      req.mode === "note"
        ? "Condense the discussion below into a study note the learner will pin on the page. Markdown, at most 90 words: a one-line takeaway in bold, then 2–4 bullets with the key facts, formulas or steps. No preamble."
        : "Give a 3–7 word title for this discussion topic. Reply with the title only, no quotes or punctuation at the end.";
    const content: BetaContentBlockParam[] = [
      { type: "text", text: contextBlock(req) },
      { type: "text", text: `${instruction}\n\n<discussion>\n${transcript || "(no discussion yet)"}\n</discussion>` },
    ];
    return [{ role: "user", content }];
  }

  // Chat: put the page context (and region image) on the first learner turn.
  const out: BetaMessageParam[] = [];
  history.forEach((m, i) => {
    if (i === 0 && m.role === "user") {
      const content: BetaContentBlockParam[] = [];
      const img = req.image ? parseDataUrl(req.image) : null;
      if (img) content.push({ type: "image", source: { type: "base64", ...img } });
      content.push({ type: "text", text: contextBlock(req) });
      content.push({ type: "text", text: m.content });
      out.push({ role: "user", content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  });
  // The conversation must start with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export interface StreamSink {
  delta(text: string): void;
  done(info: { stopReason: string | null; model: string }): void;
  error(message: string): void;
}

export async function streamTutor(req: ChatRequest, sink: StreamSink, signal: AbortSignal): Promise<void> {
  if (!isLive()) return streamDemo(req, sink, signal);

  const messages = buildMessages(req);
  if (messages.length === 0) return sink.error("Nothing to answer yet.");

  try {
    const stream = getClient().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: req.mode === "title" ? 1024 : 32000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { effort: req.mode === "chat" ? EFFORT : "low" },
        messages,
        ...(FALLBACK_MODELS.has(MODEL)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") sink.delta(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      sink.delta("\n\n_The tutor declined to answer this request._");
    }
    sink.done({ stopReason: final.stop_reason, model: final.model });
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof Anthropic.AuthenticationError) return sink.error("The Anthropic API key was rejected.");
    if (err instanceof Anthropic.RateLimitError) return sink.error("Rate limited by the AI service — try again in a moment.");
    if (err instanceof Anthropic.APIError) return sink.error(`AI service error (${err.status ?? "network"}): ${err.message}`);
    sink.error(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Demo tutor: lets the product be shown with no API key. It builds a
// plausible, page-grounded answer from the extracted text and streams it.
// ---------------------------------------------------------------------------

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 320);
}

function keyTerms(text: string, n = 5): string[] {
  const stop = new Set(
    ("the and for that with this from are was were which their there these those into have has had been being about when " +
      "where what will would could should also such than then them they your you our can not but its it's each every other " +
      "only more most many much some same very just like used using uses use make makes made does done into over under " +
      "between because while after before during called known often always never one two three first second may might must")
      .split(" "),
  );
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (!stop.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

export function demoAnswer(req: ChatRequest): string {
  const question = [...req.history].reverse().find((m) => m.role === "user")?.content ?? "";
  const source = req.anchor?.quote || req.pageText;
  const sents = sentences(source);
  const pageSents = sentences(req.pageText);
  const terms = keyTerms(req.pageText);

  if (req.mode === "title") {
    const t = (req.anchor?.quote || question || terms.join(" ")).replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : `Page ${req.page} discussion`;
  }
  if (req.mode === "note") {
    const lastAnswer = [...req.history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const bullets = sentences(lastAnswer || source).slice(0, 3);
    return [
      `**${(sents[0] ?? `Key idea from page ${req.page}`).slice(0, 110)}**`,
      ...bullets.map((b) => `- ${b}`),
      ...(terms.length ? [`- Key terms: ${terms.slice(0, 4).join(", ")}`] : []),
    ].join("\n");
  }

  const q = question.toLowerCase();
  const intro = "> _Demo tutor — add an `ANTHROPIC_API_KEY` on the server for full AI answers._\n\n";
  if (/quiz|test me|question/.test(q)) {
    const target = sents[0] ?? pageSents[0];
    return (
      intro +
      `**Quick check — page ${req.page}**\n\n` +
      (target
        ? `In your own words, explain what this means and why it matters:\n\n> ${target}\n\nReply with your answer and I'll give feedback.`
        : `What is the single most important idea on this page? Reply and I'll give feedback.`)
    );
  }
  if (/summar|overview|tl;?dr/.test(q)) {
    return (
      intro +
      `**Summary of page ${req.page}**\n\n` +
      (pageSents.slice(0, 4).map((s) => `- ${s}`).join("\n") || "- This page has little extractable text.") +
      (terms.length ? `\n\n**Key terms:** ${terms.join(", ")}` : "")
    );
  }
  if (/example|analogy/.test(q)) {
    return (
      intro +
      `**An example to anchor the idea**\n\n` +
      `Take the statement: _${sents[0] ?? "the main idea on this page"}_\n\n` +
      `1. Picture a concrete case where this applies in everyday life.\n` +
      `2. Identify which part of that case maps to **${terms[0] ?? "the main concept"}**.\n` +
      `3. Ask what would change if that part were removed — that is the role it plays.\n\n` +
      `Try writing your own example and I'll check it.`
    );
  }
  const core = sents.slice(0, 2).join(" ") || pageSents.slice(0, 2).join(" ");
  return (
    intro +
    (req.anchor?.kind === "region"
      ? `**About the selected region on page ${req.page}**\n\n`
      : `**${/simpl|eli5|plain/.test(q) ? "In plain words" : "Explanation"}**\n\n`) +
    (core ? `The core idea: ${core}\n\n` : "") +
    (terms.length ? `**Key terms to know:** ${terms.slice(0, 4).map((t) => `**${t}**`).join(", ")}\n\n` : "") +
    `**Why it matters:** this idea connects to the rest of the page${req.pageCount > 1 ? " and builds toward what follows in the next pages" : ""}. ` +
    `Ask a follow-up, branch the discussion to explore an alternative, or pin this answer as a note on the page.`
  );
}

async function streamDemo(req: ChatRequest, sink: StreamSink, signal: AbortSignal): Promise<void> {
  const text = demoAnswer(req);
  const chunks = text.match(/\S+\s*|\s+/g) ?? [text];
  for (const c of chunks) {
    if (signal.aborted) return;
    sink.delta(c);
    await new Promise((r) => setTimeout(r, req.mode === "chat" ? 18 : 4));
  }
  sink.done({ stopReason: "end_turn", model: "demo" });
}
