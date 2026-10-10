import { useState } from "react";
import { setShowAiSettings, useStore } from "../store/useStore";
import { Icon } from "./Icon";

export function AiBadge() {
  const health = useStore((s) => s.health);
  if (!health) return null;
  const live = health.ai.mode === "live";
  const label = live ? `AI live · ${health.ai.model}` : health.backend === "browser" ? "Demo tutor · add API key" : "Demo tutor";
  const title = live
    ? `Answers by ${health.ai.model}`
    : health.backend === "browser"
      ? "Answers come from a built-in demo tutor. Click to use your own Anthropic API key for real AI answers."
      : "No ANTHROPIC_API_KEY on the server — a built-in demo tutor answers from the page text";
  if (health.backend === "browser") {
    return (
      <button className={`badge ${live ? "live" : "demo"}`} style={{ border: 0, cursor: "pointer" }} title={title} onClick={() => setShowAiSettings(true)}>
        <span className="dot" /> {label}
      </button>
    );
  }
  return (
    <span className={`badge ${live ? "live" : "demo"}`} title={title}>
      <span className="dot" /> {label}
    </span>
  );
}

function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("studytree.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return (
    <button className="btn ghost icon" onClick={flip} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
