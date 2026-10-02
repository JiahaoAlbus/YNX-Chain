import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { identityActivity } from './identityActivity';
import { createRequestEpoch } from './requestEpoch';
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
  const requests = useRef(createRequestEpoch()).current;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.invalidate(); }; }, [requests]);
  useEffect(() => { requests.invalidate(); selectProject(guestProjectId); }, [guestProjectId, requests]);
  useEffect(() => { document.addEventListener('input', identityActivity.noteEditorInput); return () => document.removeEventListener('input', identityActivity.noteEditorInput); }, []);
  const [catalog, setCatalog] = useState<Catalog>(), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState(""), [account, setAccount] = useState("");
  const [exitPending, setExitPending] = useState(false);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const query = `?projectId=${encodeURIComponent(projectId)}`;
  const reload = async (captured = requests.capture()) => {
    const selected = projectId, value: Catalog = await coreRequest(query); if (!requests.current(captured) || currentProject.current !== selected) return;
    setCatalog(value); if (selected === guestProjectId) onOwnershipChange(value.nativeProjects.includes(selected) || value.sessions.some(row => row.projectId === selected && row.status !== "stopped"));
  };
  useEffect(() => {
    const captured = requests.invalidate(); setReviewed(false); setCatalog(undefined); setError(""); if (!exitPending) setBusy(false); setAccount("");
    if (!exitPending) {
      coreRequest(query).then((value: Catalog) => { if (requests.current(captured)) { setCatalog(value); if (projectId === guestProjectId) onOwnershipChange(value.nativeProjects.includes(projectId) || value.sessions.some(row => row.projectId === projectId && row.status !== "stopped")); } }).catch(cause => { if (requests.current(captured)) setError(cause.message); });
      fetch("/runtime/identity", { cache: "no-store" }).then(async result => result.ok ? result.json() : undefined).then(value => { if (requests.current(captured) && value?.connected) setAccount(value.account); }).catch(() => {});
    }
    return () => { requests.invalidate(); };
  }, [projectId, query, onOwnershipChange, guestProjectId, exitPending, requests]);
  const launch = async (activityEvent?: Pick<Event, 'isTrusted'>) => {
    const selected = projectId, captured = requests.capture(); setBusy(true); setError(""); if (selected === guestProjectId) onOwnershipChange(true);
    try {
      if (activityEvent && !await identityActivity.attest(activityEvent, 'open-project'))
        throw new Error('Sign in again before opening the project. Your files are preserved.');
      if (!requests.current(captured)) return;
      await coreRequest("", { method: "POST", body: JSON.stringify({ projectId: selected, expectedRevision: catalog?.projectRevision, approval: "launch-native-ide-once" }) });
      if (requests.current(captured)) await reload(captured);
    }
    catch (cause) { if (requests.current(captured)) { setError(cause instanceof Error ? cause.message : String(cause)); await reload(captured).catch(() => {}); } }
    finally { if (requests.current(captured)) setBusy(false); }
  };
  const copy = async () => {
    const selected = projectId, captured = requests.capture(); setBusy(true); setError("");
    try {
      const response = await fetch("/runtime/identity/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: selected, expectedGuestRevision: revision, approval: "copy-guest-project-once", approvalId: crypto.randomUUID() }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Project copy failed.");
      if (requests.current(captured)) { setReviewed(false); await reload(captured); }
    } catch (cause) { if (requests.current(captured)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (requests.current(captured)) setBusy(false); }
  };
  const stop = async (session: Session) => {
    const captured = requests.capture(); setBusy(true); setError("");
    try { await coreRequest(`/${session.sessionId}`, { method: "DELETE" }); if (requests.current(captured)) await reload(captured); }
    catch (cause) { if (requests.current(captured)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (requests.current(captured)) setBusy(false); }
  };
  const native = catalog?.nativeProjects.includes(projectId), sessions = catalog?.sessions.filter(row => row.projectId === projectId && row.status !== "stopped") || [];
  const signOut = async () => {
    requests.invalidate(); identityActivity.reset(); setAccount(''); setCatalog(undefined); setReviewed(false); setExitPending(true);
    setBusy(true);
    try {
      const response = await fetch("/runtime/identity/logout", { method: "POST" }), result = await response.json();
      if (!mounted.current) return;
      setExitPending(!response.ok || result.centralRevoked !== true || result.workspacesStopped !== true);
      if (!response.ok) throw new Error(result.workspacesStopped === false
        ? "Signed out locally. Workspace stop is not confirmed; its files and writer protection are preserved. Retry sign-out."
        : result.revocationPending ? "Signed out locally. Wallet revocation is not confirmed. Retry sign-out." : result.error || "Sign-out confirmation is unavailable. Retry sign-out.");
      setAccount(""); setCatalog(undefined);
      setError(!result.centralRevoked ? "Signed out on this device. Wallet authorization revocation has not been confirmed." : !result.workspacesStopped ? "Signed out. A workspace still needs safe stop recovery; its files are preserved." : "");
    } catch (cause) { if (mounted.current) { setExitPending(true); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="native-ide-panel side-section">
    <img className="native-brand-logo" src="/brand/ynx-logo.png" alt="YNX" /><h2>YNX Developer</h2><p><strong>{catalog?.walletProjects.find(row => row.projectId === projectId)?.name || projectName}</strong></p>
    {!account ? !exitPending && <a className="native-launch-link" href="/sso/start">Sign in with YNX Wallet</a> : <small>Wallet identity: {account}</small>}
    {(account || exitPending) && <Button disabled={busy} onClick={() => void signOut()}>{exitPending ? 'Retry sign-out' : 'Sign out on this device'}</Button>}
    {account && <Button disabled={busy} onClick={event => { const captured = requests.capture(); void identityActivity.attest(event.nativeEvent, 'edit').then(ok => { if (requests.current(captured) && !ok) setError('Sign in again if this session has reached its fixed end. Your project files are preserved.'); }).catch(() => { if (requests.current(captured)) setError('The connection is unavailable. Your project files are preserved.'); }); }}>Continue editing</Button>}
    {account && <label>Wallet projects<select value={projectId} disabled={busy} onChange={event => { requests.invalidate(); selectProject(event.target.value); }}>{!catalog?.walletProjects.some(row => row.projectId === guestProjectId) && <option value={guestProjectId}>Current guest project — copy to Wallet</option>}{catalog?.walletProjects.map(row => <option key={row.projectId} value={row.projectId}>{row.name}</option>)}</select></label>}
    {account && catalog && !catalog.walletProjectExists && <><p>Copy this saved project into your Wallet workspace. The original project stays available.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /> Copy this project to the account shown above.</label><Button disabled={busy || !admitted || !reviewed} onClick={() => void copy()}>Copy project</Button></>}
    {account && catalog?.walletProjectExists && !native && <><p>Open this project in the full editor. Its files and libraries stay in a persistent workspace; the original text copy is retained.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /> Use the native workspace for this project.</label></>}
    {account && catalog?.walletProjectExists && !sessions.length && <Button disabled={busy || !catalog.configured || (!native && !reviewed)} onClick={event => void launch(event.nativeEvent)}>{busy ? "Opening…" : "Open project"}</Button>}
    {account && sessions.map(session => <div className="native-session" key={session.sessionId}>{session.launchURL && <a className="native-launch-link" href={session.launchURL} target="_blank" rel="noopener noreferrer">Return to editor ↗</a>}{session.launchURL && <a className="native-launch-link" href={`/native-tools?sessionId=${encodeURIComponent(session.sessionId)}`} target="_blank" rel="noopener noreferrer">YNX Tools ↗</a>}<Button disabled={busy} onClick={() => void stop(session)}>{busy ? "Stopping…" : "Stop workspace"}</Button>{session.failure && <p role="alert">The workspace needs recovery. Your files are preserved; retry stopping it.</p>}</div>)}
    {error && <p role="alert">{error}</p>}
    <details><summary>About and connection details</summary><p>OpenVSCode Server {catalog?.kernel || "1.109.5"}, MIT. OpenVSX compatibility depends on its license, platform and runtime.</p><p>Wallet signing uses a separate review. AI receives the context you approve.</p>{!catalog?.configured && <p>The project runtime has not been configured for this deployment.</p>}{sessions.map(row => <p key={row.sessionId}>{row.status}{row.failure ? ` · ${row.failure}` : ""}</p>)}</details>
  </section>;
}
