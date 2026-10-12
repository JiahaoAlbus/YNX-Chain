import { Download, RefreshCcw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  loadWorkspaceHistory,
  loadWorkspaceSnapshot,
  restoreWorkspaceRevision,
  type WorkspaceHistory,
} from "../runtime/client";

type Props = {
  projectId: string;
  currentRevision: number;
  onRestored: (revision: number) => Promise<void>;
};

export function WorkspaceHistoryPanel({ projectId, currentRevision, onRestored }: Props) {
  const [history, setHistory] = useState<WorkspaceHistory>();
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setHistory(await loadWorkspaceHistory(projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId]);

  async function loadMore() {
    if (history?.nextCursor == null) return;
    setError("");
    try {
      const next = await loadWorkspaceHistory(projectId, history.nextCursor);
      setHistory({
        ...next,
        cursor: history.cursor,
        revisions: [...history.revisions, ...next.revisions],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => void load(), [load, currentRevision]);

  async function download(revision: number) {
    setBusy(revision);
    setError("");
    try {
      const snapshot = await loadWorkspaceSnapshot(projectId, revision);
      const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `ynx-workspace-${projectId}-r${revision}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function restore(revision: number) {
    const accepted = window.confirm(
      `Restore workspace revision ${revision}? This reviewed action will create a new revision after current revision ${currentRevision}; it will not erase retained history.`,
    );
    if (!accepted) return;
    setBusy(revision);
    setError("");
    try {
      const restored = await restoreWorkspaceRevision(projectId, currentRevision, revision);
      await onRestored(restored.revision);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="side-section workspace-history">
      <header>
        <strong>WORKSPACE HISTORY</strong>
        <button type="button" onClick={() => void load()} title="Refresh history" aria-label="Refresh history">
          <RefreshCcw size={14} />
        </button>
      </header>
      <p className="muted">Server-local snapshots retain the latest {history?.retention.maximumRevisions ?? 50} revisions. Export important revisions for independent backup.</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      {!history && !error && <p className="muted">Loading revision history…</p>}
      {history?.revisions.length === 0 && <p className="muted">No retained revisions yet.</p>}
      <div className="history-list">
        {history?.revisions.map((item) => (
          <article className="history-entry" key={item.revision}>
            <div>
              <strong>Revision {item.revision}{item.revision === currentRevision ? " · current" : ""}</strong>
              <span>{item.source}{item.restoredFrom ? ` from r${item.restoredFrom}` : ""}</span>
              <span>{item.files} files · {item.bytes.toLocaleString()} bytes</span>
              <span title={item.digest}>SHA-256 {item.digest.slice(0, 12)}…</span>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
            </div>
            <div className="history-actions">
              <button type="button" disabled={busy !== undefined} onClick={() => void download(item.revision)} title={`Export revision ${item.revision}`}><Download size={14} /> Export</button>
              <button type="button" disabled={busy !== undefined || item.revision === currentRevision} onClick={() => void restore(item.revision)} title={`Restore revision ${item.revision}`}><RotateCcw size={14} /> Restore</button>
            </div>
          </article>
        ))}
      </div>
      {history?.nextCursor != null && <button type="button" className="history-more" onClick={() => void loadMore()}>Load older revisions</button>}
    </section>
  );
}
