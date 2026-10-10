import { useState } from "react";
import { browserAiSettings } from "../lib/ai";
import { saveAiSettings, setShowAiSettings, toast } from "../store/useStore";
import { Icon } from "./Icon";

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best quality)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest)" },
];

/** Static demo only: lets a viewer use their own Anthropic API key from this browser. */
export function AiSettingsDialog() {
  const current = browserAiSettings();
  const [key, setKey] = useState(current.apiKey);
  const [model, setModel] = useState(current.model);
  const save = () => {
    try {
      saveAiSettings(key, model);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  return (
    <div className="modal-back" onClick={() => setShowAiSettings(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <div className="modal-head">
          <h2 id="ai-title">AI tutor settings</h2>
          <button className="btn ghost icon" onClick={() => setShowAiSettings(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            This online demo has no server, so a built-in demo tutor answers from the page text. For real AI answers, paste
            your own Anthropic API key. It is stored only in this browser and sent only to <code>api.anthropic.com</code>.
            Use a key with a spending limit, and don't enter it on a shared computer.
          </p>
          <label style={{ display: "block", fontWeight: 600, fontSize: 13, margin: "12px 0 4px" }} htmlFor="ai-key">
            Anthropic API key
          </label>
          <input
            id="ai-key"
            className="text"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <label style={{ display: "block", fontWeight: 600, fontSize: 13, margin: "12px 0 4px" }} htmlFor="ai-model">
            Model
          </label>
          <select id="ai-model" className="text" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12 }}>
            Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            {current.apiKey && (
              <button className="btn danger" onClick={() => saveAiSettings("", model)}>
                Remove key
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={() => setShowAiSettings(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
