import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { collectRuntimeRecovery, downloadRuntimeRecovery, loadRuntimeRecoveries, type RecoveryCopy, type RuntimeRecovery } from "./client";

export function RecoveryPanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<RuntimeRecovery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setEntries([]); setError(""); setNotice("");
    void loadRuntimeRecoveries().then(rows => {
      if (generation.current === current) setEntries(rows.filter(row => row.projectId === projectId));
    }).catch(value => {
      if (generation.current === current) setError(value instanceof Error ? value.message : "Recovery information could not load.");
    });
    return () => { generation.current++; };
  }, [projectId]);

  async function action(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const current = generation.current;
    try {
      await operation();
      const rows = await loadRuntimeRecoveries();
      if (generation.current === current) setEntries(rows.filter(row => row.projectId === projectId));
    } catch (value) {
      if (generation.current === current) setError(value instanceof Error ? value.message : "The recovery operation could not finish.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  function collect(entry: RuntimeRecovery) {
    const current = generation.current;
    void action(async () => {
      await collectRuntimeRecovery(entry);
      if (generation.current === current) setNotice("A copy was saved. Download it below; the remote workspace remains protected.");
    });
  }

  function download(entry: RuntimeRecovery, copy: RecoveryCopy) {
    const current = generation.current;
    void action(async () => {
      const blob = await downloadRuntimeRecovery(entry.runtimeId, copy);
      if (generation.current !== current) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `ynx-recovery-${copy.copyId}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice("Download started. It contains a copy of your text files and does not replace your open project.");
    });
  }

  return <div className="runtime-block recovery-panel" aria-label="Workspace recovery">
    <header><strong>RECOVER WORKSPACE FILES</strong><Button className="recovery-control" disabled={busy} onClick={() => void action(async () => {})}>Refresh</Button></header>
    <p>After a disconnected session or interrupted command, collect a text-file copy before working on those files again. The remote process may still be writing, so this copy can be incomplete.</p>
    {!entries.length && !error && <p>No protected workspace is recorded for this project.</p>}
    {entries.map(entry => <article className="recovery-entry" key={entry.recoveryId}>
      <strong>{entry.projectId}</strong>
      <p>{entry.runtimeId.startsWith("ssh-") ? "Remote SSH" : "Cloud workspace"} · {entry.runtimeId.slice(-10)} · {entry.status === "active" ? "Session is still active" : "Original files are protected"}</p>
      <p>A copy includes up to 256 text files and 2 MiB. Binary files and symbolic links are omitted. Downloading does not clear protection or prove the remote process stopped.</p>
      <Button className="recovery-control" disabled={busy || entry.status === "active" || entry.copies.length + entry.previousCopies.length >= 4} onClick={() => collect(entry)}>Collect a file copy</Button>
      {entry.status === "active" && <p>Stop the session under “Project processes”, then refresh this list.</p>}
      {entry.copies.length + entry.previousCopies.length >= 4 && <p>Four copies are already saved for this runtime. Download an existing copy below.</p>}
      {entry.copies.map(copy => <div className="recovery-copy" key={copy.copyId}>
        <span>{new Date(copy.createdAt).toLocaleString()} · {copy.fileCount} files · {copy.bytes < 1024 ? `${copy.bytes} B` : `${(copy.bytes / 1024).toFixed(1)} KiB`}</span>
        <Button className="recovery-control" disabled={busy} onClick={() => download(entry, copy)}>Download copy</Button>
      </div>)}
      {entry.previousCopies.length > 0 && <section aria-label="Earlier session copies">
        <strong>Earlier session copies</strong>
        <p>These belong to earlier sessions and may belong to another project.</p>
        {entry.previousCopies.map(copy => <div className="recovery-copy" key={copy.copyId}>
          <span>{copy.projectId} · {new Date(copy.createdAt).toLocaleString()} · {copy.fileCount} files</span>
          <Button className="recovery-control" disabled={busy} onClick={() => download(entry, copy)}>Download earlier copy</Button>
        </div>)}
      </section>}
    </article>)}
    {busy && <p role="status">Working…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
