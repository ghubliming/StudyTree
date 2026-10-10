import { AiSettingsDialog } from "./components/AiSettingsDialog";
import { Library } from "./components/Library";
import { Workspace } from "./components/Workspace";
import { useStore } from "./store/useStore";

export function App() {
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy);
  const toasts = useStore((s) => s.toasts);
  const showAi = useStore((s) => s.showAiSettings);
  return (
    <>
      {view === "library" ? <Library /> : <Workspace />}
      {showAi && <AiSettingsDialog />}
      {busy && (
        <div className="busy" role="status">
          <div className="busy-card">
            <div className="spinner" />
            {busy}
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
