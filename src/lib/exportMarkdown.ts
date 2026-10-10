import { buildOutline } from "./outline";
import { topicStats, type NodeMap } from "./tree";
import type { DocMeta } from "./types";

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => (l ? prefix + l : prefix.trimEnd()))
    .join("\n");
}

export function buildMarkdown(doc: DocMeta, nodes: NodeMap): string {
  const lines: string[] = [];
  lines.push(`# Study notes — ${doc.title}`, "");
  lines.push(`_Exported from StudyTree on ${new Date().toLocaleString()} · ${doc.pageCount} pages_`, "");
  for (const item of buildOutline(nodes)) {
    switch (item.kind) {
      case "page":
        lines.push(`## Page ${item.page}`, "");
        break;
      case "topic": {
        const s = topicStats(nodes, item.topic.id);
        lines.push(`### ${item.label} · ${item.topic.title}`, "");
        lines.push(`_${s.messages} messages · ${s.leaves} thread ending${s.leaves === 1 ? "" : "s"}${s.branches ? ` · ${s.branches} branch${s.branches === 1 ? "" : "es"}` : ""}_`, "");
        if (item.topic.anchor.quote) lines.push(indentBlock(item.topic.anchor.quote, "> "), "");
        break;
      }
      case "branch":
        lines.push(`${"  ".repeat(item.indent)}**↳ Branch ${item.index} of ${item.count}**`, "");
        break;
      case "msg": {
        const who = item.msg.role === "user" ? "🧑 **You**" : "🤖 **Tutor**";
        const pad = "  ".repeat(item.indent);
        lines.push(`${pad}${who}${item.msg.action ? ` _(${item.msg.action})_` : ""}`, "");
        lines.push(indentBlock(item.msg.content.trim(), pad + (item.indent ? "| " : "")), "");
        break;
      }
      case "note":
        lines.push(`#### 📝 ${item.label} · Note`, "");
        lines.push(indentBlock(item.note.content.trim(), "> "), "");
        break;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
