import { useMemo } from "react";
import { activeLeafOf, layoutTopicTree, messageChildren, newestLeafUnder, nodeLabel, pathTo } from "../lib/tree";
import type { TopicNode } from "../lib/types";
import { setActiveLeaf, setFocusMsg, setRightTab, useStore } from "../store/useStore";

const NW = 150;
const NH = 46;
const GX = 22;
const GY = 30;

function wrapLabel(text: string, perLine = 24, lines = 2): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      out.push(cur.trim());
      cur = w;
      if (out.length === lines) break;
    } else cur += " " + w;
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim());
  if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = out[lines - 1].slice(0, perLine - 1) + "…";
  return out;
}

/** The topic's discussion drawn as a tree: root → messages → branches → leaves. */
export function TopicMap({ topic }: { topic: TopicNode }) {
  const nodes = useStore((s) => s.nodes);
  const layout = useMemo(() => layoutTopicTree(nodes, topic.id), [nodes, topic.id]);
  const active = useMemo(() => new Set(pathTo(nodes, activeLeafOf(nodes, topic)).map((n) => n.id)), [nodes, topic]);
  const byId = new Map(layout.map((l) => [l.id, l]));
  const cols = Math.max(1, ...layout.map((l) => l.x + 1));
  const rows = Math.max(1, ...layout.map((l) => l.depth + 1));
  const W = cols * (NW + GX) + GX;
  const H = rows * (NH + GY) + GY;
  const px = (x: number) => GX + x * (NW + GX);
  const py = (d: number) => GY / 2 + d * (NH + GY);

  return (
    <>
      <div className="map-legend">
        <span><i style={{ background: "var(--accent-2)", border: "1px solid var(--accent)" }} />You</span>
        <span><i style={{ background: "var(--surface-2)", border: "1px solid var(--border-strong)" }} />Tutor</span>
        <span><i style={{ background: "transparent", border: "2px solid var(--success)" }} />Thread ending (leaf)</span>
        <span><i style={{ background: "var(--accent)" }} />Current path</span>
      </div>
      <div className="map-wrap">
        <svg width={W} height={H} role="img" aria-label="Discussion tree map">
          {layout.map((l) => {
            if (!l.parent) return null;
            const p = byId.get(l.parent)!;
            const on = active.has(l.id) && active.has(l.parent);
            const x1 = px(p.x) + NW / 2;
            const y1 = py(p.depth) + NH;
            const x2 = px(l.x) + NW / 2;
            const y2 = py(l.depth);
            const my = (y1 + y2) / 2;
            return (
              <path
                key={`e_${l.id}`}
                d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                fill="none"
                stroke={on ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={on ? 2.5 : 1.5}
              />
            );
          })}
          {layout.map((l) => {
            const n = l.node;
            const isTopic = n.type === "topic";
            const isUser = n.type === "msg" && n.role === "user";
            const leaf = !isTopic && messageChildren(nodes, n.id).length === 0;
            const on = active.has(n.id);
            const fill = isTopic ? topic.color : isUser ? "var(--accent-2)" : "var(--surface-2)";
            const stroke = leaf ? "var(--success)" : on ? "var(--accent)" : isTopic ? topic.color : "var(--border-strong)";
            const label = isTopic ? topic.title : nodeLabel(n, 60);
            const lines = wrapLabel(label);
            return (
              <g
                key={n.id}
                className="map-node"
                transform={`translate(${px(l.x)},${py(l.depth)})`}
                onClick={() => {
                  if (isTopic) return;
                  setActiveLeaf(topic.id, newestLeafUnder(nodes, n.id));
                  setFocusMsg(n.id);
                  setRightTab("thread");
                }}
              >
                <title>{isTopic ? topic.title : `${isUser ? "You" : "Tutor"}: ${nodeLabel(n, 300)}`}</title>
                <rect width={NW} height={NH} rx={8} fill={fill} stroke={stroke} strokeWidth={leaf || on ? 2 : 1.2} />
                <text x={8} y={14} fill={isTopic ? "#fff" : "var(--text-3)"} style={{ fontSize: 9.5, fontWeight: 700 }}>
                  {isTopic ? `TOPIC · p.${topic.page}` : isUser ? "YOU" : "TUTOR"}
                  {!isTopic && n.type === "msg" && n.action ? ` · ${n.action}` : ""}
                </text>
                {lines.map((t, i) => (
                  <text key={i} x={8} y={28 + i * 12} fill={isTopic ? "#fff" : "var(--text)"}>
                    {t}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
