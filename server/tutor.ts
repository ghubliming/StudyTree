import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, runClaude, streamDemo, type ChatRequest, type Effort, type StreamSink } from "../shared/tutorCore.js";

export type { ChatRequest } from "../shared/tutorCore.js";

export const MODEL = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
const EFFORT = (process.env.CLAUDE_EFFORT || "medium") as Effort;

export function isLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;

export function streamTutor(req: ChatRequest, sink: StreamSink, signal: AbortSignal): Promise<void> {
  if (!isLive()) return streamDemo(req, sink, signal);
  client ??= new Anthropic();
  return runClaude(client, { model: MODEL, effort: EFFORT }, req, sink, signal);
}
