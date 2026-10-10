export type TutorMode = "chat" | "note" | "title";

export interface ChatPayload {
  mode: TutorMode;
  docTitle: string;
  page: number;
  pageCount: number;
  pageText: string;
  contextText?: string;
  anchor?: { kind: "text" | "region" | "page"; quote?: string };
  topicTitle?: string;
  image?: string;
  history: { role: "user" | "assistant"; content: string }[];
}

export interface Health {
  ok: boolean;
  ai: { mode: "live" | "demo"; model: string };
  convert: boolean;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const r = await fetch("/api/health");
    return r.ok ? ((await r.json()) as Health) : null;
  } catch {
    return null;
  }
}

/** Stream a tutor reply. Resolves with the full text; throws on error. */
export async function streamChat(
  payload: ChatPayload,
  onDelta: (text: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
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
