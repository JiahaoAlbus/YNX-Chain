import { useState, type ReactNode } from "react";
import { backupRecoveryAndStartNew, restoreProject, workspaceRecoveryProblem } from "../state/workspace";

export function WorkspaceRecoveryGate({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState(workspaceRecoveryProblem);
  const [error, setError] = useState("");
  if (!problem) return children;
  const hasAppWorkspace = Boolean(restoreProject(window.ynxDesktopWorkspace?.initialProject));
  const download = async () => {
    if (problem.raw === null) return;
    try {
      if (window.ynxDesktopWorkspace) {
        await window.ynxDesktopWorkspace.exportProject("ynx-workspace-recovery.json", problem.raw);
      } else {
        const href = URL.createObjectURL(new Blob([problem.raw], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = "ynx-workspace-recovery.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch { setError("The download could not be saved. Your original data is still stored."); }
  };
  const startNew = () => {
    if (problem.raw === null) return;
    try {
      backupRecoveryAndStartNew(problem.raw);
      setError("");
      setProblem(workspaceRecoveryProblem());
    } catch (value) {
      setError(value instanceof Error ? value.message : "The backup could not be saved. Your original data is unchanged.");
    }
  };
  return <main className="workspace-recovery" aria-labelledby="workspace-recovery-title">
    <section>
      <p className="edition">YNX CODE</p>
      <h1 id="workspace-recovery-title">Your saved workspace needs recovery</h1>
      <p>{problem.kind === "unreadable"
        ? "Browser storage could not be read. Restore access and retry to open your saved workspace."
        : "Your saved data could not be opened within this version's workspace limits. It has been kept unchanged, and automatic saving is paused."}</p>
      {problem.kind === "invalid" && <p>Download the original data before recovering it elsewhere. Continuing keeps a separate copy in this browser's storage.{hasAppWorkspace ? " Your saved app workspace will then open." : " You can then start a new workspace."}</p>}
      <div className="workspace-recovery-actions">
        {problem.raw !== null && <button type="button" onClick={() => void download()}>Download saved data</button>}
        <button type="button" onClick={() => { setError(""); setProblem(workspaceRecoveryProblem()); }}>Retry recovery</button>
        {problem.raw !== null && <button type="button" onClick={startNew}>{hasAppWorkspace ? "Keep backup and open app workspace" : "Keep backup and start new workspace"}</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
