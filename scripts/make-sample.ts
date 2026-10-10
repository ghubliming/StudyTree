/**
 * Generates the bundled demo content:
 *   public/samples/neural-networks.pdf        a 5-page textbook chapter
 *   public/samples/neural-networks.studytree  the same chapter with a seeded
 *                                             discussion tree and notes
 * Run with `npm run sample`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildPack } from "../src/lib/pack";
import type { DocMeta, MessageNode, NoteNode, Rect, StudyNode, TopicNode } from "../src/lib/types";

const W = 595.28;
const H = 841.89;
const M = 64;

interface Para {
  page: number;
  lines: Rect[];
  text: string;
}

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.TimesRoman);
const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const sans = await doc.embedFont(StandardFonts.Helvetica);

let page!: PDFPage;
let y = 0;
let pageNo = 0;

function newPage() {
  page = doc.addPage([W, H]);
  pageNo++;
  y = H - M;
  page.drawText("Chapter 3 · Neural Networks", { x: M, y: H - 36, size: 8.5, font: sans, color: rgb(0.45, 0.45, 0.5) });
  page.drawText(String(pageNo), { x: W - M, y: 36, size: 9, font: sans, color: rgb(0.45, 0.45, 0.5) });
}

function norm(x: number, top: number, w: number, h: number): Rect {
  return { x: x / W, y: (H - top) / H, w: w / W, h: h / H };
}

function para(text: string, opts: { size?: number; f?: PDFFont; indent?: number; gap?: number } = {}): Para {
  const size = opts.size ?? 11;
  const f = opts.f ?? font;
  const x = M + (opts.indent ?? 0);
  const maxW = W - M - x;
  const lead = size * 1.42;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  const rects: Rect[] = [];
  for (const l of lines) {
    y -= lead;
    page.drawText(l, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
    const tw = f.widthOfTextAtSize(l, size);
    rects.push(norm(x - 1, y + size * 0.92, tw + 2, size * 1.2));
  }
  y -= opts.gap ?? 8;
  return { page: pageNo, lines: rects, text };
}

function heading(text: string, size = 15) {
  y -= size + 10;
  page.drawText(text, { x: M, y, size, font: bold, color: rgb(0.12, 0.2, 0.45) });
  y -= 6;
}

function formula(text: string) {
  y -= 22;
  const tw = italic.widthOfTextAtSize(text, 13);
  page.drawText(text, { x: (W - tw) / 2, y, size: 13, font: italic, color: rgb(0.1, 0.1, 0.12) });
  y -= 14;
}

// ------------------------------------------------------------------ page 1
newPage();
y -= 10;
page.drawText("CHAPTER 3", { x: M, y, size: 10, font: bold, color: rgb(0.85, 0.45, 0.05) });
y -= 34;
page.drawText("Neural Networks", { x: M, y, size: 28, font: bold, color: rgb(0.1, 0.12, 0.2) });
y -= 18;
para(
  "Neural networks are function approximators built from many simple units. Each unit computes a weighted sum of its inputs and passes it through a non-linear function. Stacked in layers, these units can represent remarkably complex relationships, from recognising handwriting to translating languages.",
  { f: italic, size: 11.5, gap: 14 },
);
heading("3.1 The Perceptron");
const pPerceptron = para(
  "The perceptron, introduced by Frank Rosenblatt in 1958, is the simplest neural unit. It receives an input vector x, multiplies each component by a weight, adds a bias b, and outputs 1 if the result is positive and 0 otherwise. Geometrically, the weights define a hyperplane that splits the input space into two half-spaces: one for each class.",
);
formula("y = step( w · x + b )");
para(
  "The weights w and the bias b are learned from labelled examples. The perceptron learning rule nudges the weights toward misclassified positive examples and away from misclassified negative ones. If the two classes can be separated by a straight line (or hyperplane), this procedure is guaranteed to converge.",
);
const pXor = para(
  "However, a single perceptron cannot solve problems that are not linearly separable. The classic counter-example is XOR: no single line separates the points (0,1) and (1,0) from (0,0) and (1,1). This limitation, highlighted by Minsky and Papert in 1969, motivated networks with hidden layers.",
);
heading("Key idea", 12);
para("A perceptron is a linear classifier. Depth (hidden layers) plus non-linearity is what gives neural networks their expressive power.", {
  indent: 12,
  f: italic,
});

// ------------------------------------------------------------------ page 2
newPage();
heading("3.2 Multi-layer Networks");
para(
  "A multi-layer perceptron (MLP) chains layers of units. The first layer receives the input, one or more hidden layers transform it, and the output layer produces the prediction. Figure 3.1 shows a network with three inputs, four hidden units and one output.",
);
// Figure 3.1 — a small network diagram
const figTop = y - 8;
const figH = 210;
const cols = [M + 70, W / 2, W - M - 70];
const layers = [3, 4, 1];
const pos: { x: number; y: number }[][] = layers.map((n, li) =>
  Array.from({ length: n }, (_, i) => ({ x: cols[li], y: figTop - 30 - ((i + 0.5) * (figH - 60)) / n })),
);
for (let li = 0; li < 2; li++)
  for (const a of pos[li]) for (const b of pos[li + 1]) page.drawLine({ start: a, end: b, thickness: 0.7, color: rgb(0.6, 0.65, 0.75) });
const colors = [rgb(0.2, 0.45, 0.9), rgb(0.95, 0.6, 0.1), rgb(0.15, 0.65, 0.4)];
pos.forEach((layer, li) =>
  layer.forEach((p, i) => {
    page.drawCircle({ x: p.x, y: p.y, size: 14, color: colors[li], borderColor: rgb(1, 1, 1), borderWidth: 1.5 });
    const label = li === 0 ? `x${i + 1}` : li === 1 ? `h${i + 1}` : "y";
    page.drawText(label, { x: p.x - sans.widthOfTextAtSize(label, 9) / 2, y: p.y - 3, size: 9, font: bold, color: rgb(1, 1, 1) });
  }),
);
["Input layer", "Hidden layer", "Output"].forEach((t, i) =>
  page.drawText(t, { x: cols[i] - sans.widthOfTextAtSize(t, 9) / 2, y: figTop - figH + 12, size: 9, font: sans, color: rgb(0.35, 0.35, 0.4) }),
);
page.drawRectangle({ x: M, y: figTop - figH, width: W - 2 * M, height: figH, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 0.8 });
const figRect = norm(M, figTop, W - 2 * M, figH);
y = figTop - figH - 4;
para("Figure 3.1 — A fully connected network with one hidden layer. Every arrow carries a learnable weight.", { size: 9.5, f: italic, gap: 12 });
heading("3.3 Activation Functions");
const pAct = para(
  "Without a non-linear activation, stacking layers would collapse into a single linear map. The sigmoid function squashes values into (0, 1) and was popular historically, but its gradient vanishes for large inputs. The rectified linear unit, ReLU(z) = max(0, z), is cheap to compute and keeps gradients alive for positive inputs, which is why it became the default choice in deep networks.",
);
formula("sigmoid(z) = 1 / (1 + e^(-z))        ReLU(z) = max(0, z)");

// ------------------------------------------------------------------ page 3
newPage();
heading("3.4 Training with Gradient Descent");
para(
  "Training means choosing weights that make the network's predictions match the labels. We measure the mismatch with a loss function L, for example the mean squared error or the cross-entropy. Gradient descent then repeatedly moves every weight a small step against the gradient of the loss:",
);
formula("w  <-  w  -  eta * dL/dw");
const pLr = para(
  "The learning rate eta controls the step size. If it is too large the updates overshoot the minimum and the loss oscillates or diverges; if it is too small training crawls and may stall on plateaus. In practice the learning rate is the single most important hyper-parameter to tune, and schedules that decrease it over time are common.",
);
para(
  "Computing the gradient on the full dataset is expensive. Stochastic gradient descent (SGD) estimates it from a small random mini-batch instead. The noise this introduces is not only cheaper, it also helps the optimiser escape shallow local minima.",
);
heading("Worked example", 12);
para(
  "Suppose a weight w = 0.80, the gradient dL/dw = 0.50 and eta = 0.10. The update gives w = 0.80 - 0.10 * 0.50 = 0.75. The weight moved slightly in the direction that reduces the loss.",
  { indent: 12 },
);

// ------------------------------------------------------------------ page 4
newPage();
heading("3.5 Backpropagation");
para(
  "Backpropagation is the algorithm that computes dL/dw for every weight efficiently. It applies the chain rule of calculus layer by layer, starting at the output and moving backward. Each layer receives the gradient of the loss with respect to its outputs, multiplies it by its local derivative, and passes the result to the layer before it.",
);
formula("dL/dw1 = dL/dy * dy/dh * dh/dw1");
para(
  "Because intermediate results from the forward pass are reused, backpropagation costs roughly the same as one forward pass. This efficiency is what makes training networks with millions of parameters practical.",
);
para(
  "Two classic difficulties appear in deep networks. Vanishing gradients occur when many small derivatives are multiplied together, so early layers barely learn. Exploding gradients are the opposite problem. ReLU activations, careful weight initialisation, normalisation layers and residual connections all mitigate these issues.",
);

// ------------------------------------------------------------------ page 5
newPage();
heading("Review Questions");
[
  "1. Why can a single perceptron not learn the XOR function? Sketch the four points to justify your answer.",
  "2. What would happen to a deep network if every activation function were the identity f(z) = z?",
  "3. Compare sigmoid and ReLU. Give one advantage of each.",
  "4. A training loss oscillates wildly from step to step. Which hyper-parameter would you change first, and how?",
  "5. Explain in your own words why backpropagation is efficient.",
].forEach((q) => para(q, { gap: 10 }));
heading("Further reading", 12);
para("Goodfellow, Bengio and Courville, Deep Learning (MIT Press, 2016), chapters 6-8.", { f: italic });

const pdfBytes = await doc.save();

// ------------------------------------------------------------------ seeded study tree
const docId = "sample_neural_networks";
const t0 = Date.parse("2026-10-01T09:00:00Z");
let clock = t0;
const tick = () => (clock += 45_000);
const nodes: StudyNode[] = [];
let seq = 0;
const id = (p: string) => `${p}_sample${++seq}`;

function topic(page: number, title: string, color: string, anchor: TopicNode["anchor"]): TopicNode {
  const t: TopicNode = { id: id("topic"), docId, type: "topic", parentId: null, page, title, color, anchor, createdAt: tick(), updatedAt: clock };
  nodes.push(t);
  return t;
}
function msg(parent: { id: string }, topicNode: TopicNode, role: "user" | "assistant", content: string, action?: string): MessageNode {
  const m: MessageNode = {
    id: id("msg"), docId, type: "msg", parentId: parent.id, topicId: topicNode.id, page: topicNode.page, role, content,
    status: "done", createdAt: tick(), updatedAt: clock, ...(action ? { action } : {}),
  };
  nodes.push(m);
  return m;
}
function note(page: number, parent: TopicNode | null, box: Rect, content: string, color = "#fff4b8", source?: MessageNode): NoteNode {
  const n: NoteNode = {
    id: id("note"), docId, type: "note", parentId: parent?.id ?? null, page, box, content, color,
    createdAt: tick(), updatedAt: clock, ...(source ? { sourceId: source.id } : {}),
  };
  nodes.push(n);
  return n;
}

// Topic 1 — perceptron, with two branches.
const t1 = topic(1, "What a perceptron actually computes", "#f5b700", { kind: "text", rects: pPerceptron.lines, quote: pPerceptron.text });
const q1 = msg(t1, t1, "user", "What does the perceptron actually compute? I don't get the hyperplane part.");
const a1 = msg(q1, t1, "assistant",
  "**Core idea:** a perceptron computes a weighted sum of its inputs, adds a bias, and fires (outputs 1) only if that sum is positive.\n\n" +
  "$$y = \\text{step}(w \\cdot x + b)$$\n\n" +
  "**The hyperplane part.** The set of inputs where $w \\cdot x + b = 0$ is a boundary:\n\n" +
  "- In 2-D it is a **line**, in 3-D a **plane**, in higher dimensions a *hyperplane*.\n" +
  "- Points on one side give a positive sum → class 1; the other side → class 0.\n" +
  "- The weights $w$ set the boundary's **orientation**, the bias $b$ shifts it away from the origin.\n\n" +
  "So learning a perceptron = sliding and rotating one straight boundary until it separates the two classes.");
const q1a = msg(a1, t1, "user", "Explain it even more simply, like I'm 12.", "Explain simply");
msg(q1a, t1, "assistant",
  "Imagine sorting apples and oranges on a table by drawing **one straight chalk line**.\n\n" +
  "- Each fruit has measurements (size, colour) — those are the inputs.\n" +
  "- The perceptron gives each measurement an importance score (the weights) and adds them up.\n" +
  "- If the total is above zero → *apple* side of the line; otherwise → *orange* side.\n\n" +
  "Training is just moving and turning the chalk line until every fruit is on the correct side.");
const q1b = msg(a1, t1, "user", "Give me a concrete numeric example.", "Give an example");
const a1b = msg(q1b, t1, "assistant",
  "Let $w = (2, -1)$, $b = -1$ and the input $x = (1, 0.5)$.\n\n" +
  "1. Weighted sum: $2\\cdot1 + (-1)\\cdot0.5 = 1.5$\n" +
  "2. Add bias: $1.5 - 1 = 0.5$\n" +
  "3. Step: $0.5 > 0$ → **output 1**.\n\n" +
  "For $x = (0, 1)$: $0 - 1 - 1 = -2 < 0$ → **output 0**. The boundary is the line $2x_1 - x_2 - 1 = 0$.");
const q1c = msg(a1b, t1, "user", "Quiz me on this.", "Quiz me");
msg(q1c, t1, "assistant",
  "**Question 1:** With the same $w = (2, -1)$ and $b = -1$, what does the perceptron output for $x = (0.5, 0)$? Show the weighted sum.\n\n_Reply with your answer and I'll check it._");
t1.activeLeafId = a1b.id;
note(1, t1, { x: 0.52, y: 0.7, w: 0.4, h: 0.12 },
  "**Perceptron = one straight boundary.**\n- Output 1 when w·x + b > 0\n- w sets orientation, b shifts it\n- Can't do XOR (not linearly separable)", "#fff4b8", a1);

// Topic 2 — XOR.
const t2 = topic(1, "Why XOR breaks a single perceptron", "#d03050", { kind: "text", rects: pXor.lines, quote: pXor.text });
const q2 = msg(t2, t2, "user", "Why exactly can't one line separate XOR?");
msg(q2, t2, "assistant",
  "Plot the four inputs: $(0,0)$ and $(1,1)$ are class 0, $(0,1)$ and $(1,0)$ are class 1. They sit on **opposite corners** of a square.\n\n" +
  "Any straight line that puts $(0,1)$ and $(1,0)$ on the same side must cut across the square, and then it also traps at least one of the class-0 corners on that side. So no single linear boundary works.\n\n" +
  "**Fix:** a hidden layer can compute two lines (e.g. OR and NAND) and the output unit combines them with AND — that solves XOR.");

// Topic 3 — figure region.
const t3 = topic(2, "Reading Figure 3.1", "#2f5bea", { kind: "region", rects: [figRect] });
const q3 = msg(t3, t3, "user", "Walk me through this diagram. How many weights are there?");
msg(q3, t3, "assistant",
  "The figure is a **3 → 4 → 1** fully connected network:\n\n" +
  "- **Input layer** $x_1..x_3$ (blue): raw features, no computation.\n" +
  "- **Hidden layer** $h_1..h_4$ (orange): each computes $\\text{ReLU}(w \\cdot x + b)$.\n" +
  "- **Output** $y$ (green): combines the four hidden values.\n\n" +
  "**Counting parameters:** input→hidden has $3 \\times 4 = 12$ weights, hidden→output has $4 \\times 1 = 4$, so **16 weights**, plus **5 biases** (one per non-input unit) = **21 learnable parameters**.");

// Topic 4 — activations.
const t4 = topic(2, "Sigmoid vs ReLU", "#18a058", { kind: "text", rects: pAct.lines, quote: pAct.text });
const q4 = msg(t4, t4, "user", "Why does the sigmoid gradient vanish, and why doesn't ReLU have that problem?");
const a4 = msg(q4, t4, "assistant",
  "The sigmoid's derivative is $\\sigma'(z) = \\sigma(z)(1-\\sigma(z))$, which is **at most 0.25** and close to 0 when $|z|$ is large (the curve is flat there).\n\n" +
  "Backpropagation multiplies one such factor per layer, so after 10 layers the signal can shrink by $0.25^{10} \\approx 10^{-6}$ — early layers stop learning.\n\n" +
  "ReLU's derivative is exactly **1 for $z > 0$**, so gradients pass through unchanged on active units. Its weakness: units stuck at $z < 0$ get gradient 0 (\"dying ReLU\").");
const q4b = msg(a4, t4, "user", "So should I never use sigmoid?");
msg(q4b, t4, "assistant",
  "Not quite — avoid it in **hidden layers** of deep nets, but it is still the right choice for a **binary output** layer, because it turns a score into a probability in $(0,1)$. Gates in LSTMs also use sigmoids.");
note(2, t4, { x: 0.6, y: 0.86, w: 0.34, h: 0.1 },
  "**Hidden layers → ReLU, binary output → sigmoid.**\n- sigmoid' ≤ 0.25 → vanishing gradients\n- ReLU' = 1 for z > 0", "#dcfce7", a4);

// Topic 5 — learning rate, two branches.
const t5 = topic(3, "Choosing the learning rate", "#8a4bd8", { kind: "text", rects: pLr.lines, quote: pLr.text });
const q5 = msg(t5, t5, "user", "How do I know if my learning rate is wrong?");
const a5 = msg(q5, t5, "assistant",
  "Watch the training loss curve:\n\n" +
  "| Symptom | Likely cause |\n|---|---|\n| Loss jumps around or becomes NaN | η **too high** |\n| Loss falls very slowly, almost flat | η **too low** |\n| Fast drop, then smooth flattening | η about right |\n\n" +
  "A practical recipe: start around $10^{-3}$ (Adam) or $10^{-1}$ (SGD), and try values ×3 / ÷3 apart.");
const q5a = msg(a5, t5, "user", "What exactly happens when it's too high?");
msg(q5a, t5, "assistant",
  "Each step $\\eta \\cdot \\partial L/\\partial w$ is larger than the distance to the minimum, so the weight **jumps over** the valley to the other side — often higher up. The loss oscillates, and if the overshoot grows each step it **diverges** to infinity (you'll see NaN).");
const q5b = msg(a5, t5, "user", "And what's a learning-rate schedule?");
msg(q5b, t5, "assistant",
  "A schedule changes η during training: start large to make fast progress, then shrink it to settle precisely into a minimum. Common choices: **step decay** (÷10 every N epochs), **cosine decay**, and a short **warm-up** at the start.");
note(3, t5, { x: 0.06, y: 0.72, w: 0.4, h: 0.12 },
  "**η too high → overshoot / NaN. η too low → crawl.**\nTry 1e-3 (Adam), 1e-1 (SGD); tune ×3 steps; decay over time.", "#ede4ff");

// Topic 6 — whole page summary.
const t6 = topic(4, "Backpropagation in one page", "#00a0b0", { kind: "page", rects: [] });
const q6 = msg(t6, t6, "user", "Summarize this page for revision.", "Summarize page");
msg(q6, t6, "assistant",
  "**Backpropagation in 4 bullets**\n\n" +
  "- Computes $\\partial L/\\partial w$ for **every** weight using the **chain rule**, from output back to input.\n" +
  "- Each layer multiplies the incoming gradient by its local derivative and passes it on.\n" +
  "- Reuses forward-pass values, so it costs about **one extra forward pass**.\n" +
  "- Deep nets suffer **vanishing/exploding gradients**; fixes: ReLU, good initialisation, normalisation, residual connections.");

note(5, null, { x: 0.55, y: 0.06, w: 0.38, h: 0.09 }, "Exam prep: answer Q1–Q4 using the topics pinned on pages 1–3.", "#dbeafe");

const meta: DocMeta = {
  id: docId,
  title: "Chapter 3 — Neural Networks",
  fileName: "neural-networks.pdf",
  sourceType: "pdf",
  pageCount: pageNo,
  createdAt: t0,
  updatedAt: clock,
};

const map = Object.fromEntries(nodes.map((n) => [n.id, n]));
const pack = await buildPack(meta, map, pdfBytes);
mkdirSync("public/samples", { recursive: true });
writeFileSync("public/samples/neural-networks.pdf", pdfBytes);
writeFileSync("public/samples/neural-networks.studytree", pack);
console.log(`Sample: ${pageNo} pages, ${nodes.length} nodes → public/samples/`);
