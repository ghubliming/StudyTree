import { DEFAULT_MODEL, runClaude, streamDemo, type ChatRequest, type StreamSink } from "../../shared/tutorCore";

export type TutorMode = ChatRequest["mode"];
export type ChatPayload = Omit<ChatRequest, "language">;

export interface Health {
  ok: boolean;
  ai: { mode: "live" | "demo"; model: string };
  convert: boolean;
  /** "server": answers come from our API. "browser": static hosting (e.g. GitHub Pages). */
  backend: "server" | "browser";
}

/**
 * Where tutor answers come from. With the Node server running we use /api/chat.
 * On static hosting there is no server, so the app runs the demo tutor in the
 * browser, or calls Claude directly with a key the learner pastes in (kept only
 * in this browser's storage).
 */
let backend: Health["backend"] = "server";

const KEY = "studytree.apiKey";
const MODEL_KEY = "studytree.model";

function readSetting(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}

export function browserAiSettings(): { apiKey: string; model: string } {
  return { apiKey: readSetting(KEY), model: readSetting(MODEL_KEY) || DEFAULT_MODEL };
}

export function saveBrowserAiSettings(apiKey: string, model: string): void {
  try {
    if (apiKey) localStorage.setItem(KEY, apiKey);
    else localStorage.removeItem(KEY);
    localStorage.setItem(MODEL_KEY, model || DEFAULT_MODEL);
  } catch {
    throw new Error("This browser blocks local storage, so the key can't be saved.");
  }
}

export function browserHealth(): Health {
  const { apiKey, model } = browserAiSettings();
  return { ok: true, ai: apiKey ? { mode: "live", model } : { mode: "demo", model: "demo-tutor" }, convert: false, backend: "browser" };
}

export async function fetchHealth(): Promise<Health> {
  if (import.meta.env.VITE_STATIC) {
    backend = "browser";
    return browserHealth();
  }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/health`);
    // Static hosts answer unknown paths with HTML or 404: treat as "no server".
    const h = (await r.json()) as Omit<Health, "backend">;
    if (!r.ok || !h.ok) throw new Error("no server");
    backend = "server";
    return { ...h, backend };
  } catch {
    backend = "browser";
    return browserHealth();
  }
}

/** Stream a tutor reply. Resolves with the full text; throws on error. */
export async function streamChat(
  payload: ChatPayload,
  onDelta: (text: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return backend === "server" ? streamFromServer(payload, onDelta, signal) : streamInBrowser(payload, onDelta, signal);
}

async function streamInBrowser(
  payload: ChatPayload,
  onDelta: (text: string, full: string) => void,
  signal = new AbortController().signal,
): Promise<string> {
  let full = "";
  let failure: string | null = null;
  const sink: StreamSink = {
    delta: (t) => {
      full += t;
      onDelta(t, full);
    },
    done: () => {},
    error: (m) => {
      failure = m;
    },
  };
  const { apiKey, model } = browserAiSettings();
  if (apiKey) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    await runClaude(client, { model, effort: "medium" }, payload, sink, signal);
  } else {
    await streamDemo(payload, sink, signal, "click “Demo tutor” at the top to add your Anthropic API key for full AI answers");
  }
  if (failure) throw new Error(failure);
  return full;
}

async function streamFromServer(
  payload: ChatPayload,
  onDelta: (text: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Tutor unavailable (HTTP ${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5).trim()) as { type: string; text?: string; message?: string };
        if (evt.type === "delta" && evt.text) {
          full += evt.text;
          onDelta(evt.text, full);
        } else if (evt.type === "error") {
          throw new Error(evt.message ?? "Tutor error");
        }
      }
    }
  }
  return full;
}
