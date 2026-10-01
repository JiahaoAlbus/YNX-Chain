import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
type Session = { sessionId: string; projectId: string; status: string; failure: string | null; launchURL?: string };
type Catalog = { configured: boolean; kernel: string; nativeProjects: string[]; sessions: Session[]; walletProjectExists: boolean; projectRevision: number; walletProjects: { projectId: string; name: string; revision: number }[] };
async function coreRequest(path = "", options?: RequestInit) {
  const response = await fetch(`/runtime/codeoss${path}`, { ...options, headers: { "content-type": "application/json" }, cache: "no-store" });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "The workspace connection is unavailable."); return value;
}
export function NativeIDEPanel({ projectId: guestProjectId, projectName, revision, admitted, onOwnershipChange }: {
  projectId: string; projectName: string; revision: number; admitted: boolean; onOwnershipChange: (value: boolean) => void;
}) {
  const [projectId, selectProject] = useState(guestProjectId);
  useEffect(() => { selectProject(guestProjectId); }, [guestProjectId]);
  const [catalog, setCatalog] = useState<Catalog>(), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState(""), [account, setAccount] = useState("");
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const query = `?projectId=${encodeURIComponent(projectId)}`;
  const reload = async () => {
    const selected = projectId, value: Catalog = await coreRequest(query); if (currentProject.current !== selected) return;
    setCatalog(value); if (selected === guestProjectId) onOwnershipChange(value.nativeProjects.includes(selected) || value.sessions.some(row => row.projectId === selected && row.status !== "stopped"));
  };
  useEffect(() => {
    let current = true; setReviewed(false); setCatalog(undefined); setError(""); setBusy(false); setAccount("");
    coreRequest(query).then((value: Catalog) => { if (current) { setCatalog(value); if (projectId === guestProjectId) onOwnershipChange(value.nativeProjects.includes(projectId) || value.sessions.some(row => row.projectId === projectId && row.status !== "stopped")); } }).catch(cause => { if (current) setError(cause.message); });
    fetch("/runtime/identity", { cache: "no-store" }).then(result => result.json()).then(value => { if (current && value.connected) setAccount(value.account); }).catch(() => {});
    return () => { current = false; };
  }, [projectId, query, onOwnershipChange]);
  const launch = async () => {
    const selected = projectId; setBusy(true); setError(""); if (selected === guestProjectId) onOwnershipChange(true);
    try { await coreRequest("", { method: "POST", body: JSON.stringify({ projectId: selected, expectedRevision: catalog?.projectRevision, approval: "launch-native-ide-once" }) }); if (currentProject.current === selected) await reload(); }
    catch (cause) { if (currentProject.current === selected) { setError(cause instanceof Error ? cause.message : String(cause)); await reload().catch(() => {}); } }
    finally { if (currentProject.current === selected) setBusy(false); }
  };
  const copy = async () => {
    const selected = projectId; setBusy(true); setError("");
    try {
      const response = await fetch("/runtime/identity/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: selected, expectedGuestRevision: revision, approval: "copy-guest-project-once", approvalId: crypto.randomUUID() }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Project copy failed.");
      if (currentProject.current === selected) { setReviewed(false); await reload(); }
    } catch (cause) { if (currentProject.current === selected) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (currentProject.current === selected) setBusy(false); }
  };
  const stop = async (session: Session) => {
    const selected = projectId; setBusy(true); setError("");
    try { await coreRequest(`/${session.sessionId}`, { method: "DELETE" }); if (currentProject.current === selected) await reload(); }
    catch (cause) { if (currentProject.current === selected) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (currentProject.current === selected) setBusy(false); }
  };
  const native = catalog?.nativeProjects.includes(projectId), sessions = catalog?.sessions.filter(row => row.projectId === projectId && row.status !== "stopped") || [];
  const signOut = async () => {
    setBusy(true);
    try {
      const response = await fetch("/runtime/identity/logout", { method: "POST" }), result = await response.json();
      if (!response.ok) throw new Error(result.error || "Local sign-out failed.");
      setAccount(""); setCatalog(undefined);
      setError(!result.centralRevoked ? "Signed out on this device. Wallet authorization revocation has not been confirmed." : !result.workspacesStopped ? "Signed out. A workspace still needs safe stop recovery; its files are preserved." : "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="native-ide-panel side-section">
    <img className="native-brand-logo" src="/brand/ynx-logo.png" alt="YNX" /><h2>YNX Developer</h2><p><strong>{catalog?.walletProjects.find(row => row.projectId === projectId)?.name || projectName}</strong></p>
    {!account ? <a className="native-launch-link" href="/sso/start">Sign in with YNX Wallet</a> : <small>Wallet identity: {account}</small>}
    {account && <Button disabled={busy} onClick={() => void signOut()}>Sign out on this device</Button>}
    {account && <label>Wallet projects<select value={projectId} disabled={busy} onChange={event => selectProject(event.target.value)}>{!catalog?.walletProjects.some(row => row.projectId === guestProjectId) && <option value={guestProjectId}>Current guest project — copy to Wallet</option>}{catalog?.walletProjects.map(row => <option key={row.projectId} value={row.projectId}>{row.name}</option>)}</select></label>}
    {catalog && !catalog.walletProjectExists && <><p>Copy this saved project into your Wallet workspace. The original project stays available.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /> Copy this project to the account shown above.</label><Button disabled={busy || !admitted || !reviewed} onClick={() => void copy()}>Copy project</Button></>}
    {catalog?.walletProjectExists && !native && <><p>Open this project in the full editor. Its files and libraries stay in a persistent workspace; the original text copy is retained.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /> Use the native workspace for this project.</label></>}
    {catalog?.walletProjectExists && !sessions.length && <Button disabled={busy || !catalog.configured || (!native && !reviewed)} onClick={() => void launch()}>{busy ? "Opening…" : "Open project"}</Button>}
    {sessions.map(session => <div key={session.sessionId}>{session.launchURL && <a className="native-launch-link" href={session.launchURL} target="_blank" rel="noopener noreferrer">Return to editor ↗</a>}<Button disabled={busy} onClick={() => void stop(session)}>{busy ? "Stopping…" : "Stop workspace"}</Button>{session.failure && <p role="alert">The workspace needs recovery. Your files are preserved; retry stopping it.</p>}</div>)}
    {error && <p role="alert">{error}</p>}
    <details><summary>About and connection details</summary><p>OpenVSCode Server {catalog?.kernel || "1.109.5"}, MIT. OpenVSX compatibility depends on its license, platform and runtime.</p><p>Wallet signing uses a separate review. AI receives the context you approve.</p>{!catalog?.configured && <p>The project runtime has not been configured for this deployment.</p>}{sessions.map(row => <p key={row.sessionId}>{row.status}{row.failure ? ` · ${row.failure}` : ""}</p>)}</details>
  </section>;
}
