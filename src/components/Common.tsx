import { useState } from "react";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";

export function AiBadge() {
  const health = useStore((s) => s.health);
  if (!health) return <span className="badge" title="The server is not reachable">
    <span className="dot" /> AI offline
  </span>;
  const live = health.ai.mode === "live";
  return (
    <span
      className={`badge ${live ? "live" : "demo"}`}
      title={live ? `Answers by ${health.ai.model}` : "No ANTHROPIC_API_KEY on the server — a built-in demo tutor answers from the page text"}
    >
      <span className="dot" /> {live ? `AI live · ${health.ai.model}` : "Demo tutor"}
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
