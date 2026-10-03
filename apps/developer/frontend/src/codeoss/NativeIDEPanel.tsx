import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { identityActivity } from './identityActivity';
import { createRequestEpoch } from './requestEpoch';
import { editorEntry, workspaceStatus, type NativeSession as Session } from './sessionNavigation';
type Catalog = { account: string; generation: number; identityKey: string; configured: boolean; kernel: string; nativeProjects: string[]; sessions: Session[]; walletProjectExists: boolean; projectRevision: number; walletProjects: { projectId: string; name: string; revision: number }[] };
const unauthorized = (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 401;
async function privateRequest(path: string, options?: RequestInit, identityKey?: string) {
  const headers = new Headers(options?.headers); headers.set("content-type", "application/json");
  if (identityKey) headers.set("x-ynx-agent-identity", identityKey);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "The workspace connection is unavailable."), { status: response.status, code: value.code });
  return value;
}
async function coreRequest(path = "", options?: RequestInit, identityKey?: string) {
  return privateRequest(`/runtime/codeoss${path}`, options, identityKey);
}
type PanelProps = {
  projectId: string; projectName: string; revision: number; admitted: boolean; onOwnershipChange: (value: boolean) => void; guestProjectAvailable?: boolean;
};
export function NativeIDEPanel(props: PanelProps) {
  if (window.ynxDesktopWorkspace && window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1')
    return <section className="native-ide-panel side-section"><img className="native-brand-logo" src="/brand/ynx-logo.png" alt="YNX" /><h2>Wallet projects</h2><p>Open your Wallet projects in the hosted editor. This local project stays available.</p><a className="native-launch-link" href="https://developer.ynxweb4.com/projects" target="_blank" rel="noopener noreferrer">Open Wallet projects ↗</a><p>To copy this project, export it here, import it in the hosted guest workspace, then review the copy to your Wallet account.</p></section>;
  return <WalletIDEPanel {...props} />;
}
function WalletIDEPanel({ projectId: guestProjectId, projectName, revision, admitted, onOwnershipChange, guestProjectAvailable = true }: PanelProps) {
  const [projectId, selectProject] = useState(guestProjectId);
  const requests = useRef(createRequestEpoch()).current;
  const mounted = useRef(false), verified = useRef(false), actor = useRef("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.invalidate(); }; }, [requests]);
  useEffect(() => { requests.invalidate(); selectProject(guestProjectId); }, [guestProjectId, requests]);
  useEffect(() => { document.addEventListener('input', identityActivity.noteEditorInput); return () => document.removeEventListener('input', identityActivity.noteEditorInput); }, []);
  const [catalog, setCatalog] = useState<Catalog>(), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exitPending, setExitPending] = useState(false);
  const progress = useRef({ key: "", attempts: 0 });
  const [newProjectName, setNewProjectName] = useState(''), [createReviewed, setCreateReviewed] = useState(false);
  const createIntent = useRef<{ name: string; identityKey: string; approvalId: string } | undefined>(undefined);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const query = `?projectId=${encodeURIComponent(projectId)}`;
  const current = (captured: number) => mounted.current && requests.current(captured);
  const retire = (cause: unknown) => {
    requests.invalidate(); verified.current = false; actor.current = ""; identityActivity.reset();
    setCatalog(undefined); setReviewed(false); setCreateReviewed(false); createIntent.current = undefined; setBusy(false); setLoading(false);
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const reload = async (message = "") => {
    if (exitPending) return;
    const selected = projectId, captured = requests.invalidate(); verified.current = false;
    setLoading(true); setBusy(false); setReviewed(false); setError(message);
    try {
      const value: Catalog = await coreRequest(query); if (!current(captured) || currentProject.current !== selected) return;
      if (actor.current !== value.identityKey) { identityActivity.reset(); setCreateReviewed(false); createIntent.current = undefined; }
      if ((!guestProjectAvailable || selected !== guestProjectId) && !value.walletProjects.some(project => project.projectId === selected) && (guestProjectAvailable || value.walletProjects.length > 0)) {
        actor.current = value.identityKey; setCatalog(value); selectProject(value.walletProjects[0]?.projectId || guestProjectId); return;
      }
      actor.current = value.identityKey; verified.current = true; setCatalog(value);
      if (guestProjectAvailable && selected === guestProjectId) onOwnershipChange(value.nativeProjects.includes(selected) || value.sessions.some(row => row.projectId === selected && row.status !== "stopped"));
    } catch (cause) {
      if (!current(captured)) return;
      if (unauthorized(cause)) retire(cause);
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (current(captured)) setLoading(false); }
  };
  useEffect(() => {
    verified.current = false; requests.invalidate(); setReviewed(false); setError(""); if (!exitPending) setBusy(false);
    if (!exitPending) void reload();
    else setLoading(false);
    const focus = () => { if (!exitPending) void reload(); };
    window.addEventListener("focus", focus);
    return () => { verified.current = false; requests.invalidate(); window.removeEventListener("focus", focus); };
  }, [projectId, query, onOwnershipChange, guestProjectId, guestProjectAvailable, exitPending, requests]);
  useEffect(() => {
    const pending = catalog?.sessions.filter(row => row.projectId === projectId && ["preparing", "stopping"].includes(row.status)) || [];
    const key = `${projectId}:${catalog?.identityKey || ""}:${pending.map(row => `${row.sessionId}:${row.status}`).join(",")}`;
    if (progress.current.key !== key) progress.current = { key, attempts: 0 };
    if (!pending.length || loading || busy || exitPending || !verified.current || progress.current.attempts >= 8) return;
    const timer = window.setTimeout(() => { progress.current.attempts++; void reload(); }, 2500);
    return () => window.clearTimeout(timer);
  }, [catalog, projectId, loading, busy, exitPending]);
  const handleError = (cause: unknown, captured: number) => {
    if (!current(captured)) return;
    if (unauthorized(cause)) retire(cause);
    else setError(cause instanceof Error ? cause.message : String(cause));
  };
  const recoverOperation = async (cause: unknown, captured: number) => {
    if (!current(captured)) return;
    if (unauthorized(cause)) handleError(cause, captured);
    else await reload(cause instanceof Error ? cause.message : String(cause));
  };
  const context = () => {
    if (!verified.current || !catalog || loading || busy || exitPending) return null;
    return { selected: projectId, captured: requests.capture(), identityKey: catalog.identityKey, expectedRevision: catalog.projectRevision };
  };
  const account = catalog?.account || "", disabled = busy || loading || !verified.current;
  const launch = async (activityEvent?: Pick<Event, 'isTrusted'>) => {
    const value = context(); if (!value) return;
    const { selected, captured, identityKey, expectedRevision } = value;
    setBusy(true); setError(""); if (selected === guestProjectId) onOwnershipChange(true);
    try {
      if (activityEvent && !await identityActivity.attest(activityEvent, 'open-project'))
        throw new Error('Sign in again before opening the project. Your files are preserved.');
      if (!current(captured)) return;
      await coreRequest("", { method: "POST", body: JSON.stringify({ projectId: selected, expectedRevision, approval: "launch-native-ide-once" }) }, identityKey);
      if (current(captured)) await reload();
    } catch (cause) { await recoverOperation(cause, captured); }
    finally { if (current(captured)) setBusy(false); }
  };
  const copy = async () => {
    const value = context(); if (!value) return;
    if (!guestProjectAvailable || value.selected !== guestProjectId) return;
    const { selected, captured, identityKey } = value; setBusy(true); setError("");
    try {
      await privateRequest("/runtime/identity/import", { method: "POST", body: JSON.stringify({ projectId: selected, expectedGuestRevision: revision, approval: "copy-guest-project-once", approvalId: crypto.randomUUID() }) }, identityKey);
      if (current(captured)) await reload();
    } catch (cause) { await recoverOperation(cause, captured); }
    finally { if (current(captured)) setBusy(false); }
  };
  const createProject = async () => {
    const value = context(), name = newProjectName.trim();
    if (!value || !createReviewed || !name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) return;
    const { captured, identityKey } = value;
    if (!createIntent.current || createIntent.current.name !== name || createIntent.current.identityKey !== identityKey)
      createIntent.current = { name, identityKey, approvalId: crypto.randomUUID() };
    const approvalId = createIntent.current.approvalId;
    setBusy(true); setError('');
    try {
      const saved = await privateRequest('/runtime/identity/projects', { method: 'POST', body: JSON.stringify({ name, approvalId, approval: 'create-wallet-project-once' }) }, identityKey);
      if (!current(captured)) return;
      setNewProjectName(''); setCreateReviewed(false); createIntent.current = undefined;
      if (saved.projectId === projectId) await reload(); else selectProject(saved.projectId);
    } catch (cause) { await recoverOperation(cause, captured); }
    finally { if (current(captured)) setBusy(false); }
  };
  const stop = async (session: Session) => {
    const value = context(); if (!value) return;
    if (session.projectId !== value.selected || !catalog?.sessions.some(row => row.sessionId === session.sessionId && row.projectId === value.selected && row.status !== "stopped")) return;
    const { captured, identityKey } = value; setBusy(true); setError("");
    try {
      await coreRequest(`/${encodeURIComponent(session.sessionId)}`, { method: "DELETE" }, identityKey);
      if (current(captured)) await reload();
    } catch (cause) { await recoverOperation(cause, captured); }
    finally { if (current(captured)) setBusy(false); }
  };
  const native = catalog?.nativeProjects.includes(projectId), sessions = catalog?.sessions.filter(row => row.projectId === projectId && row.status !== "stopped") || [];
  const signOut = async () => {
    requests.invalidate(); verified.current = false; actor.current = ""; identityActivity.reset(); setCatalog(undefined); setReviewed(false); setCreateReviewed(false); createIntent.current = undefined; setExitPending(true);
    setBusy(true);
    try {
      const response = await fetch("/runtime/identity/logout", { method: "POST" }), result = await response.json();
      if (!mounted.current) return;
      setExitPending(!response.ok || result.centralRevoked !== true || result.workspacesStopped !== true);
      if (!response.ok) throw new Error(result.workspacesStopped === false
        ? "Signed out locally. Workspace stop is not confirmed; its files and writer protection are preserved. Retry sign-out."
        : result.revocationPending ? "Signed out locally. Wallet revocation is not confirmed. Retry sign-out." : result.error || "Sign-out confirmation is unavailable. Retry sign-out.");
      setCatalog(undefined);
      setError(!result.centralRevoked ? "Signed out on this device. Wallet authorization revocation has not been confirmed." : !result.workspacesStopped ? "Signed out. A workspace still needs safe stop recovery; its files are preserved." : "");
    } catch (cause) { if (mounted.current) { setExitPending(true); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="native-ide-panel side-section">
    <img className="native-brand-logo" src="/brand/ynx-logo.png" alt="YNX" /><h2>YNX Developer</h2><p><strong>{catalog?.walletProjects.find(row => row.projectId === projectId)?.name || projectName}</strong></p>
    {!account ? !exitPending && !loading && <a className="native-launch-link" href="/sso/start">Sign in with YNX Wallet</a> : <small>Wallet identity: {account}</small>}
    {!exitPending && <Button disabled={loading} onClick={() => void reload()}>{loading ? "Loading Wallet projects…" : "Refresh Wallet projects"}</Button>}
    {(account || exitPending) && <Button disabled={busy} onClick={() => void signOut()}>{exitPending ? 'Retry sign-out' : 'Sign out on this device'}</Button>}
    {account && <Button disabled={disabled} onClick={event => { const captured = requests.capture(); void identityActivity.attest(event.nativeEvent, 'edit').then(ok => { if (current(captured) && !ok) setError('Sign in again if this session has reached its fixed end. Your project files are preserved.'); }).catch(() => { if (current(captured)) setError('The connection is unavailable. Your project files are preserved.'); }); }}>Continue editing</Button>}
    {account && (guestProjectAvailable || Boolean(catalog?.walletProjects.length)) && <label>Wallet projects<select aria-label="Native Wallet projects" value={projectId} disabled={disabled} onChange={event => { verified.current = false; requests.invalidate(); selectProject(event.target.value); }}>{guestProjectAvailable && !catalog?.walletProjects.some(row => row.projectId === guestProjectId) && <option value={guestProjectId}>Current guest project — copy to Wallet</option>}{catalog?.walletProjects.map(row => <option key={row.projectId} value={row.projectId}>{row.name}</option>)}</select></label>}
    {account && !guestProjectAvailable && catalog && !catalog.walletProjects.length && <p>No Wallet projects yet. Create your first project below.</p>}
    {account && <details><summary>New Wallet project</summary><label>New project name<input value={newProjectName} maxLength={160} disabled={disabled} onChange={event => { setNewProjectName(event.target.value); setCreateReviewed(false); createIntent.current = undefined; }} /></label><label className="native-review"><input type="checkbox" checked={createReviewed} disabled={disabled} onChange={event => setCreateReviewed(event.target.checked)} /> Create an empty project for {account}.</label><Button disabled={disabled || !createReviewed || !newProjectName.trim() || /[\u0000-\u001f\u007f]/.test(newProjectName)} onClick={() => void createProject()}>Create Wallet project</Button></details>}
    {account && guestProjectAvailable && catalog && projectId === guestProjectId && !catalog.walletProjectExists && <><p>Copy this saved project into your Wallet workspace. The original project stays available.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} /> Copy this project to the account shown above.</label><Button disabled={disabled || !admitted || !reviewed} onClick={() => void copy()}>Copy project</Button></>}
    {account && catalog?.walletProjectExists && !native && <><p>Open this project in the full editor. Its files and libraries stay in a persistent workspace; the original text copy is retained.</p><label className="native-review"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} /> Use the native workspace for this project.</label></>}
    {account && catalog?.walletProjectExists && !sessions.length && <Button disabled={disabled || !catalog.configured || (!native && !reviewed)} onClick={event => void launch(event.nativeEvent)}>{busy ? "Opening…" : "Open project"}</Button>}
    {account && catalog && !catalog.configured && <p>The full editor is unavailable on this server. Your saved projects are preserved.</p>}
    {account && sessions.map(session => {
      const entry = verified.current ? editorEntry(session, projectId) : undefined;
      return <div className="native-session" key={session.sessionId}><p role="status">{workspaceStatus(session)}</p>{entry && <a className="native-launch-link" href={entry} target="_blank" rel="noopener noreferrer">Return to editor ↗</a>}{entry && <a className="native-launch-link" href={`/native-tools?sessionId=${encodeURIComponent(session.sessionId)}`} target="_blank" rel="noopener noreferrer">YNX Tools ↗</a>}{verified.current && session.status === "running" && !entry && !session.failure && <p role="alert">The editor connection could not be verified. Refresh your Wallet projects.</p>}<Button disabled={disabled} onClick={() => void stop(session)}>{busy ? "Stopping…" : "Stop workspace"}</Button>{session.failure && <p role="alert">Your files are preserved. Retry stopping the workspace to finish recovery.</p>}</div>;
    })}
    {error && <p role="alert">{error}</p>}
    <details><summary>About and connection details</summary><p>OpenVSCode Server {catalog?.kernel || "1.109.5"}, MIT. OpenVSX compatibility depends on its license, platform and runtime.</p><p>Wallet signing uses a separate review. AI receives the context you approve.</p>{!catalog?.configured && <p>The project runtime has not been configured for this deployment.</p>}{sessions.map(row => <p key={row.sessionId}>{row.status}{row.failure ? ` · ${row.failure}` : ""}</p>)}</details>
  </section>;
}
