import express from "express";
import multer from "multer";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isLive, MODEL, streamTutor, type ChatRequest } from "./tutor.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, ".."), path.resolve(here, "../..")].find((p) => existsSync(path.join(p, "package.json")))!;

loadDotEnv(path.join(root, ".env"));

const app = express();
app.disable("x-powered-by");

// Optional shared password (HTTP Basic, any username) so a public demo
// deployment can't be used by strangers to spend the API key.
const password = process.env.APP_PASSWORD;
if (password) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const supplied = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
    if (supplied === password) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="StudyTree"');
    res.status(401).send("Authentication required");
  });
}

app.use(express.json({ limit: "25mb" }));

// ---------------------------------------------------------------- health
let sofficePath: string | null | undefined;
async function findSoffice(): Promise<string | null> {
  if (sofficePath !== undefined) return sofficePath;
  for (const bin of [process.env.SOFFICE_PATH, "soffice", "libreoffice"].filter(Boolean) as string[]) {
    try {
      await run(bin, ["--version"], { timeout: 20000 });
      return (sofficePath = bin);
    } catch {
      /* try next */
    }
  }
  return (sofficePath = null);
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    ai: { mode: isLive() ? "live" : "demo", model: isLive() ? MODEL : "demo-tutor" },
    convert: Boolean(await findSoffice()),
  });
});

// ---------------------------------------------------------------- chat (SSE)
app.post("/api/chat", async (req, res) => {
  const body = req.body as ChatRequest;
  if (!body || !Array.isArray(body.history) || typeof body.page !== "number") {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  try {
    await streamTutor(
      {
        ...body,
        pageText: String(body.pageText ?? "").slice(0, 60000),
        contextText: body.contextText ? String(body.contextText).slice(0, 30000) : undefined,
      },
      {
        delta: (text) => send({ type: "delta", text }),
        done: (info) => send({ type: "done", ...info }),
        error: (message) => send({ type: "error", message }),
      },
      controller.signal,
    );
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ---------------------------------------------------------------- convert slides/docs → PDF
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });
const CONVERTIBLE = new Set([".ppt", ".pptx", ".pps", ".ppsx", ".odp", ".key", ".doc", ".docx", ".odt", ".rtf"]);

app.post("/api/convert", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!CONVERTIBLE.has(ext)) {
    res.status(415).json({ error: `Unsupported file type ${ext}` });
    return;
  }
  const soffice = await findSoffice();
  if (!soffice) {
    res.status(501).json({ error: "Slide conversion needs LibreOffice on the server. Export the deck to PDF and upload that instead." });
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "studytree-"));
  try {
    const input = path.join(dir, `input${ext}`);
    await writeFile(input, file.buffer);
    await run(
      soffice,
      [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "pdf", "--outdir", dir, input],
      { timeout: 180000 },
    );
    const pdf = await readFile(path.join(dir, "input.pdf"));
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    console.error("convert failed", err);
    res.status(500).json({ error: "Conversion failed. Try exporting the file to PDF first." });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------- static web app
const dist = path.join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`StudyTree server on http://localhost:${port}  (AI: ${isLive() ? `live, ${MODEL}` : "demo tutor — set ANTHROPIC_API_KEY for live AI"})`);
});

function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env) && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
