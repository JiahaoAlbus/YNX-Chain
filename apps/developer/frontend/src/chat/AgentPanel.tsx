import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { createRequestEpoch } from "../codeoss/requestEpoch";
import {
  agentAction,
  clearProjectMemory,
  createAgentRun,
  exportProjectMemory,
  indexProjectMemory,
  loadModelCatalog,
  loadAgentProjects,
  listAgentRuns,
  loadAgentRun,
  loadProjectMemoryFacts,
  loadProjectMemory,
  searchProjectMemory,
  type AgentRun,
  type AgentRunSummary,
  type ModelCatalog,
  type ProjectMemoryFact,
  type ProjectMemoryStatus,
} from "../runtime/client";

type AgentAction =
  | "create"
  | "approve-plan"
  | "approve-context"
  | "generate-proposal"
  | "revise-proposal"
  | "apply"
  | "restore-deleted"
  | "run-test"
  | "generate-fix"
  | "prepare-git"
  | "approve-git"
  | "reconcile-git"
  | "prepare-deployment"
  | "approve-deployment";
type ContextSelection = { paths: string[]; createPaths: string[]; deletePaths: string[] };

type AgentPanelProps = {
  projectId: string;
  revision: number;
  activePath: string;
  onApplied: (revision: number) => void;
};
type WalletAgentProject = { projectId: string; name: string; revision: number; activePath: string; storageMode: "text-snapshot" | "native-volume" };
type WalletAgentProjects = { account: string; generation: number; identityKey: string; projects: WalletAgentProject[] };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const unauthorized = (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 401;

// The parent still supplies its legacy guest-workbench props. Private AI uses
// only the current backend-resolved Wallet project catalog below.
export function AgentPanel(_props: AgentPanelProps) {
  const loads = useRef(createRequestEpoch()).current, privateRequests = useRef(createRequestEpoch()).current;
  const currentIdentity = useRef<WalletAgentProjects | undefined>(undefined), currentProject = useRef("");
  const privateActive = useRef(false);
  const [identity, setIdentity] = useState<WalletAgentProjects>(), [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  function retireIdentity(message: string) {
    loads.invalidate(); privateRequests.invalidate();
    privateActive.current = false; setVerified(false);
    currentIdentity.current = undefined; currentProject.current = "";
    setIdentity(undefined); setSelectedId(""); setLoading(false); setError(message);
  }
  async function refreshProjects() {
    const captured = loads.invalidate(); privateRequests.invalidate(); privateActive.current = false;
    setVerified(false); setLoading(true); setError("");
    try {
      const value = await loadAgentProjects();
      if (!loads.current(captured)) return;
      const previous = currentIdentity.current;
      const sameActor = previous?.account === value.account && previous?.generation === value.generation && previous?.identityKey === value.identityKey;
      const selected = sameActor && value.projects.some(project => project.projectId === currentProject.current)
        ? currentProject.current : (value.projects.find(project => project.storageMode === "text-snapshot") || value.projects[0])?.projectId || "";
      if (!sameActor || selected !== currentProject.current || previous?.projects.find(project => project.projectId === selected)?.storageMode !== value.projects.find(project => project.projectId === selected)?.storageMode) privateRequests.invalidate();
      currentIdentity.current = value; currentProject.current = selected;
      privateActive.current = true; setVerified(true);
      setIdentity(value); setSelectedId(selected);
    } catch (cause) {
      if (!loads.current(captured)) return;
      if (unauthorized(cause)) retireIdentity(errorMessage(cause));
      else setError(errorMessage(cause));
    } finally { if (loads.current(captured)) setLoading(false); }
  }
  useEffect(() => {
    void refreshProjects();
    const refresh = () => { void refreshProjects(); };
    window.addEventListener("focus", refresh);
    return () => { privateActive.current = false; loads.invalidate(); privateRequests.invalidate(); window.removeEventListener("focus", refresh); };
  }, [loads, privateRequests]);
  const project = identity?.projects.find(item => item.projectId === selectedId), captured = privateRequests.capture();
  const current = () => privateActive.current && privateRequests.current(captured);
  return <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
    <section className="side-section agent-projects" style={{ height: "auto", flex: "0 0 auto", fontSize: 11, overflowWrap: "anywhere" }}>
      <header><strong>Wallet AI projects</strong><Button variant="ghost" disabled={loading} onClick={() => void refreshProjects()}>{loading ? "Loading projects…" : "Refresh Wallet projects"}</Button></header>
      <div className="agent-fields">
      {identity ? <>
        <p>Wallet account · <strong>{identity.account}</strong></p>
        {identity.projects.length ? <label>Wallet project<select aria-label="Wallet project" disabled={!verified} value={selectedId} onChange={event => {
          privateRequests.invalidate(); currentProject.current = event.target.value; setSelectedId(event.target.value);
        }}>{identity.projects.map(item => <option key={item.projectId} value={item.projectId}>{item.name}{item.storageMode === "native-volume" ? " · Native IDE" : ""}</option>)}</select></label>
          : <p>This Wallet has no projects yet. Open <strong>YNX Native IDE</strong> in the activity bar and explicitly copy a saved project into this Wallet.</p>}
        {project?.storageMode === "native-volume" && <p>This project's current files live in the native editor. Open it through <strong>YNX Native IDE</strong>, then choose <strong>YNX Tools</strong> for AI review. Its old text import is not used here.</p>}
      </> : !loading && <p>Sign in to use your private Wallet projects. <a href="/sso/start">Sign in with YNX Wallet</a></p>}
      {error && <p role="alert">{error}</p>}
      </div>
    </section>
    {identity && project?.storageMode === "text-snapshot" && <fieldset disabled={!verified} aria-label="Private Wallet AI" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, minHeight: 0, flex: 1 }}><ProjectAgentPanel
      key={JSON.stringify([identity.account, identity.generation, identity.identityKey, project.projectId])}
      projectId={project.projectId} revision={project.revision} activePath={project.activePath} identityKey={identity.identityKey} enabled={verified} lifecycleEpoch={captured}
      isCurrent={current} onUnauthorized={message => { if (current()) retireIdentity(message); }}
      onApplied={() => { if (current()) void refreshProjects(); }} /></fieldset>}
  </div>;
}

function ProjectAgentPanel({ projectId, revision, activePath, identityKey, enabled, lifecycleEpoch, onApplied, isCurrent, onUnauthorized }: AgentPanelProps & {
  identityKey: string; enabled: boolean; lifecycleEpoch: number;
  isCurrent: () => boolean; onUnauthorized: (message: string) => void;
}) {
  const requests = useRef(createRequestEpoch()).current, mounted = useRef(false);
  const runRequests = useRef(createRequestEpoch()).current;
  const selectedRun = useRef<string | null | undefined>(undefined), reconciled = useRef(false);
  const previousLifecycle = useRef(lifecycleEpoch);
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [run, setRun] = useState<AgentRun>();
  const [savedRuns, setSavedRuns] = useState<AgentRunSummary[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(true), [runReady, setRunReady] = useState(false), [notice, setNotice] = useState("");
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [intent, setIntent] = useState("");
  const [provider, setProvider] = useState("ynx-hosted");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);
  const [memory, setMemory] = useState<ProjectMemoryStatus | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryResults, setMemoryResults] = useState<
    Array<{ path: string; score: number }>
  >([]);
  const [memoryFacts, setMemoryFacts] = useState<ProjectMemoryFact[]>([]);

  const current = (captured: number) => mounted.current && enabled && requests.current(captured) && isCurrent();
  function handleError(error: unknown, captured: number) {
    if (!current(captured)) return;
    if (unauthorized(error)) {
      requests.invalidate(); if (keyRef.current) keyRef.current.value = "";
      onUnauthorized(errorMessage(error));
    } else setError(errorMessage(error));
  }

  async function refreshSavedRuns(preferred = selectedRun.current) {
    const captured = requests.capture(), readEpoch = runRequests.invalidate();
    if (!current(captured)) return;
    reconciled.current = false; setRunReady(false); setRecovering(true); setBusy(false);
    if (keyRef.current) keyRef.current.value = "";
    const valid = () => current(captured) && runRequests.current(readEpoch);
    try {
      const page = await listAgentRuns(projectId, identityKey); if (!valid()) return;
      setSavedRuns(page.runs); setNextCursor(page.nextCursor);
      const id = preferred === undefined ? page.runs[0]?.runId || null : preferred;
      if (id) {
        const value = await loadAgentRun(id, identityKey); if (!valid()) return;
        if (value.projectId !== projectId) throw new Error("The saved run belongs to another project. Refresh the project list.");
        selectedRun.current = value.runId; setRun(value); setProvider(value.provider); setModel(value.model); setUncertainCreate(false);
        setSavedRuns(previous => previous.some(item => item.runId === value.runId) ? previous : [value, ...previous]);
        if (value.workspaceRevision > revision) { onApplied(value.workspaceRevision); return; }
      } else { selectedRun.current = null; setRun(undefined); }
      reconciled.current = true; setRunReady(true);
    } catch (cause) { if (valid()) handleError(cause, captured); }
    finally { if (valid()) setRecovering(false); }
  }
  async function loadMoreRuns() {
    if (nextCursor === null || recovering) return;
    const captured = requests.capture(), readEpoch = runRequests.capture(); setRecovering(true);
    const valid = () => current(captured) && runRequests.current(readEpoch);
    try {
      const page = await listAgentRuns(projectId, identityKey, nextCursor); if (!valid()) return;
      setSavedRuns(previous => [...new Map([...previous, ...page.runs].map(item => [item.runId, item])).values()]);
      setNextCursor(page.nextCursor);
    } catch (cause) { if (valid()) handleError(cause, captured); }
    finally { if (valid()) setRecovering(false); }
  }
  function newRequest() {
    if (!current(requests.capture()) || recovering || busy || run?.operation?.status === "running") return;
    runRequests.invalidate(); selectedRun.current = null; setIntent(run?.intent || intent); setRun(undefined);
    setNotice(""); setError(""); setUncertainCreate(false); if (keyRef.current) keyRef.current.value = "";
    reconciled.current = true; setRunReady(true);
  }

  const loadCatalog = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    setBusy(true);
    setError("");
    try {
      const value = await loadModelCatalog(identityKey); if (current(captured)) setCatalog(value);
    } catch (error) {
      if (current(captured)) setCatalog(undefined);
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true; const captured = requests.invalidate();
    void loadCatalog();
    setMemoryFacts([]);
    loadProjectMemory(projectId, identityKey).then(value => { if (current(captured)) setMemory(value); }).catch(error => { if (unauthorized(error)) handleError(error, captured); });
    return () => { mounted.current = false; requests.invalidate(); if (keyRef.current) keyRef.current.value = ""; };
  }, [projectId]);
  useEffect(() => {
    if (!enabled || previousLifecycle.current !== lifecycleEpoch) {
      requests.invalidate(); runRequests.invalidate(); reconciled.current = false; setRunReady(false); setBusy(false);
      if (keyRef.current) keyRef.current.value = "";
    }
    previousLifecycle.current = lifecycleEpoch;
    if (enabled) void refreshSavedRuns();
  }, [enabled, lifecycleEpoch, requests]);

  const execute = async (action: AgentAction, selection?: ContextSelection) => {
    const captured = requests.capture(), runEpoch = runRequests.capture();
    const valid = () => current(captured) && runRequests.current(runEpoch);
    if (!valid() || !reconciled.current || recovering || uncertainCreate || run?.operation?.status === "running") return;
    if (action === "approve-git" && run?.operation?.status === "interrupted" && run.operation.action === "approve-git" && run.operation.recoveryEvidence?.recheckRequired) return;
    setBusy(true);
    setError(""); setNotice("");
    try {
      const apiKey = keyRef.current?.value || undefined;
      const approvalId = crypto.randomUUID();
      let next: AgentRun;
      if (action === "create") {
        next = await createAgentRun({
          projectId,
          intent,
          provider,
          model: model || undefined,
          apiKey,
          approval: "model-request-once",
          approvalId,
        }, identityKey);
      } else if (action === "reconcile-git") {
        next = await agentAction(run!.runId, { action }, identityKey);
      } else {
        next = await agentAction(run!.runId, {
          action,
          provider,
          model: model || undefined,
          apiKey,
          approvalId,
          ...(action === "approve-context"
            ? {
                paths: selection?.paths || [],
                createPaths: selection?.createPaths || [],
                deletePaths: selection?.deletePaths || [],
                approval: "context-read-once",
              }
            : {}),
          ...(["generate-proposal", "revise-proposal", "generate-fix"].includes(
            action,
          )
            ? { approval: "model-request-once" }
            : {}),
          ...(action === "apply" ? { approval: "write-once" } : {}),
          ...(action === "restore-deleted"
            ? {
                approval: "restore-once",
                paths: run!.trash.map((file) => file.path),
              }
            : {}),
          ...(action === "run-test"
            ? { approval: "execute-once", activePath }
            : {}),
          ...(action === "prepare-git"
            ? { message: `Agent: ${run!.intent.slice(0, 72)}` }
            : {}),
          ...(action === "approve-git"
            ? { approval: "git-local-commit-once" }
            : {}),
          ...(action === "prepare-deployment"
            ? { target: "ynx-testnet" }
            : {}),
          ...(action === "approve-deployment"
            ? { approval: "deployment-review-once" }
            : {}),
        }, identityKey);
      }
      if (!valid()) return;
      selectedRun.current = next.runId;
      setRun(next);
      setSavedRuns(previous => [next, ...previous.filter(item => item.runId !== next.runId)]);
      if (action === "apply" || action === "restore-deleted")
        onApplied(next.workspaceRevision);
    } catch (error) {
      if (valid()) {
        handleError(error, captured);
        if (!unauthorized(error)) {
          if (action === "create") setUncertainCreate(true);
          setNotice("The request did not return a confirmed result. Read the saved state before approving another operation; it was not automatically sent again.");
          await refreshSavedRuns(action === "create" ? undefined : selectedRun.current);
        }
      }
    } finally {
      if (valid()) { if (keyRef.current) keyRef.current.value = ""; setBusy(false); }
    }
  };

  const needsKey = provider !== "ynx-hosted";
  const providerReady =
    provider !== "ynx-hosted" || catalog?.hosted.available === true;
  const buildMemory = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    setBusy(true);
    setError("");
    try {
      const value = await indexProjectMemory(projectId, revision, identityKey); if (!current(captured)) return;
      setMemory(value);
      setMemoryFacts([]);
    } catch (error) {
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };
  const searchMemory = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    setBusy(true);
    setError("");
    try {
      const value = await searchProjectMemory(projectId, memoryQuery, identityKey); if (current(captured)) setMemoryResults(value.results);
    } catch (error) {
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };
  const exportMemory = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    setBusy(true);
    setError("");
    try {
      const value = await exportProjectMemory(projectId, identityKey);
      if (!current(captured)) return;
      const blob = new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ynx-project-memory-${projectId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };
  const viewMemoryFacts = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    if (memory?.revision == null) return;
    setBusy(true);
    setError("");
    try {
      const value = await loadProjectMemoryFacts(projectId, memory.revision, identityKey); if (current(captured)) setMemoryFacts(value);
    } catch (error) {
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };
  const clearMemory = async () => {
    const captured = requests.capture(); if (!current(captured)) return;
    if (
      !window.confirm(
        "Clear this project memory index? The workspace files are not deleted.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await clearProjectMemory(projectId, memory?.revision ?? null, identityKey);
      if (!current(captured)) return;
      const value = await loadProjectMemory(projectId, identityKey); if (!current(captured)) return;
      setMemory(value);
      setMemoryResults([]);
      setMemoryFacts([]);
    } catch (error) {
      handleError(error, captured);
    } finally {
      if (current(captured)) setBusy(false);
    }
  };

  return (
    <section className="side-section agent-panel">
      <header>
        <strong>AI SOFTWARE ENGINEER</strong>
        <Button variant="ghost" disabled={busy} onClick={() => void loadCatalog()}>
          {busy && !catalog ? "Connecting…" : "Retry models"}
        </Button>
      </header>
      <div className={catalog?.hosted.available ? "agent-approved" : "agent-rejected"}>
        {catalog?.hosted.available
          ? `YNX hosted ${catalog.hosted.model} ready`
          : "Hosted model connection unavailable · retry or choose your own provider"}
      </div>
      <div className="agent-fields">
        <label>Saved runs<select aria-label="Saved runs" value={run?.runId || ""} disabled={recovering || busy} onChange={event => {
          setError(""); setNotice(""); void refreshSavedRuns(event.target.value || null);
        }}><option value="">New request</option>{savedRuns.map(item => <option key={item.runId} value={item.runId}>{item.intent.slice(0, 80)} · {item.status.replaceAll("_", " ")}</option>)}</select></label>
        <Button disabled={recovering} onClick={() => { setError(""); void refreshSavedRuns(); }}>{recovering ? "Reading saved state…" : "Refresh saved state"}</Button>
        {nextCursor !== null && <Button disabled={recovering || busy} onClick={() => void loadMoreRuns()}>Load more saved runs</Button>}
        {(run || uncertainCreate) && <Button disabled={recovering || busy || run?.operation?.status === "running"} onClick={newRequest}>{run ? "New request from this intent" : "Review a new request from this intent"}</Button>}
      </div>
      {notice && <p className="agent-error" role="status">{notice}</p>}
      {run?.operation?.status === "running" && <p className="agent-approved" role="status">{run.operation.action} is still running on the server. Refresh saved state to read its result. No operation is sent again automatically.</p>}
      {run?.operation?.status === "interrupted" && <p className="agent-error" role="status">The last {run.operation.action} operation was interrupted{run.operation.errorCode ? ` (${run.operation.errorCode})` : ""}. Review the saved state before approving the next operation.{run.status === "planning" ? " Start a new request from this intent to explicitly request another plan." : ""}</p>}
      <details className="memory-box">
        <summary>PROJECT MEMORY {memory ? `· ${memory.chunks} chunks` : ""}</summary>
        <small>
          Current index only · no automatic expiry · semantic vectors, source
          declarations and resolved file imports. API call graph, change history
          and preferences are not indexed yet.
        </small>
        {memory && (
          <small>
            {memory.symbols} declarations · {memory.relationships} file relations ·{" "}
            {memory.languages.join(", ") || "no languages"}
          </small>
        )}
        <div className="memory-actions">
          <Button disabled={busy || revision < 1} onClick={buildMemory}>
            {memory?.revision != null ? "Incremental rebuild" : "Index"} revision{" "}
            {revision}
          </Button>
          <Button disabled={busy || memory?.revision == null} onClick={exportMemory}>
            Export JSON
          </Button>
          <Button
            disabled={busy || memory?.revision == null}
            onClick={viewMemoryFacts}
          >
            View facts
          </Button>
          <Button disabled={busy || memory?.revision == null} onClick={clearMemory}>
            Clear
          </Button>
        </div>
        {memory?.embeddedChunks !== undefined && (
          <small>
            {memory.embeddedChunks} embedded · {memory.reusedChunks} reused
          </small>
        )}
        <div>
          <input
            aria-label="Project memory query"
            value={memoryQuery}
            onChange={(event) => setMemoryQuery(event.target.value)}
            placeholder="Semantic code search"
          />
          <Button
            disabled={busy || memoryQuery.trim().length < 2}
            onClick={searchMemory}
          >
            Search
          </Button>
        </div>
        {memoryResults.map((result) => (
          <code key={`${result.path}:${result.score}`}>
            {result.path} · {result.score.toFixed(3)}
          </code>
        ))}
        {memoryFacts.map((fact) => (
          <code key={`${fact.path}:${fact.type}:${fact.name}:${fact.line}`}>
            {fact.type} · {fact.kind} · {fact.name} · {fact.path}:{fact.line}
            {fact.type === "relation"
              ? ` → ${fact.targetPath || "external or unresolved"}`
              : ""}
          </code>
        ))}
      </details>
      <div className="agent-fields">
        <select aria-label="AI provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="ynx-hosted">
            YNX hosted · {catalog?.hosted.model || "Qwen"}
          </option>
          {catalog?.bringYourOwnKey.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · BYO Key
            </option>
          ))}
        </select>
        <input
          aria-label="AI model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Model (provider default)"
        />
        {needsKey && (
          <input
            aria-label="Request-only API key"
            ref={keyRef}
            type="password"
            autoComplete="off"
            placeholder="API key · request only"
          />
        )}
      </div>
      {!run ? (
        <>
          <textarea
            aria-label="Software change"
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Describe the software change and acceptance criteria…"
          />
          <Button
            variant="default"
            disabled={busy || recovering || !runReady || uncertainCreate || !providerReady || intent.trim().length < 4}
            onClick={() => execute("create")}
          >
            Approve model request once · create plan
          </Button>
        </>
      ) : (
        <AgentRunView key={`${run.runId}:${run.status}`} run={run} busy={busy || recovering || !runReady || run.operation?.status === "running"} execute={execute} />
      )}
      {error && <div className="agent-error">{error}</div>}
      <div className="honest-boundary">
        Planner → context approval → Coder → Reviewer → one-time write → Tester →
        reviewed local Git → deployment review. Deletes are recoverable; Agent
        Git cannot access remotes, credentials, hooks or signing.
      </div>
    </section>
  );
}

function AgentRunView({
  run,
  busy,
  execute,
}: {
  run: AgentRun;
  busy: boolean;
  execute: (action: AgentAction, selection?: ContextSelection) => void;
}) {
  const [selection, setSelection] = useState<ContextSelection>(() => ({ paths: run.plan?.contextPaths || [], createPaths: run.plan?.createPaths || [], deletePaths: run.plan?.deletePaths || [] }));
  const toggle = (kind: keyof ContextSelection, path: string, checked: boolean) => setSelection(previous => ({ ...previous, [kind]: checked ? [...previous[kind], path] : previous[kind].filter(value => value !== path) }));
  const gitRecovery = run.operation?.status === "interrupted" && run.operation.action === "approve-git" && run.operation.recoveryEvidence?.recheckRequired;
  const usage = run.usage.reportedCalls
    ? `${run.usage.inputTokens} input + ${run.usage.outputTokens} output tokens`
    : `tokens unreported (${run.usage.unreportedCalls} model calls)`;
  return (
    <div className="agent-run">
      <div className="agent-run-meta">
        <strong>{run.status.replaceAll("_", " ")}</strong>
        <span>{run.provider} · {run.model}</span>
        <small>{usage} · cost unreported by provider</small>
      </div>
      <details className="memory-box">
        <summary>
          PERMISSIONS · {run.permissions.filter((item) => item.status === "used").length} used
        </summary>
        {run.permissions.map((permission) => (
          <small key={permission.id}>
            <strong>{permission.level}</strong> · {permission.id} · {permission.status}
            {permission.uses
              ? ` · ${permission.uses} use${permission.uses === 1 ? "" : "s"}`
              : ""}
            {permission.boundary ? ` · ${permission.boundary}` : ""}
          </small>
        ))}
      </details>
      {run.plan && (
        <>
          <p>{run.plan.summary}</p>
          <ol>
            {run.plan.steps.map((step, index) => (
              <li key={index}>
                <strong>{step.title}</strong>
                <span>{step.acceptance}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {run.status === "context_review" && (
        <div className="agent-proposal">
          <strong>Requested context</strong>
          <small>Choose the files to share with Coder and Reviewer: up to 8 nonempty text files, 256 KiB each. Only checked reads are sent. Create and delete permissions are separate.</small>
          {run.plan?.contextPaths.map((path) => <label key={`read:${path}`}><input type="checkbox" disabled={busy} checked={selection.paths.includes(path)} onChange={event => toggle("paths", path, event.target.checked)} />read · {path}</label>)}
          {run.plan?.createPaths.map((path) => <label key={`create:${path}`}><input type="checkbox" disabled={busy} checked={selection.createPaths.includes(path)} onChange={event => toggle("createPaths", path, event.target.checked)} />create · {path}</label>)}
          {run.plan?.deletePaths.map((path) => <label key={`delete:${path}`}><input type="checkbox" disabled={busy} checked={selection.deletePaths.includes(path)} onChange={event => toggle("deletePaths", path, event.target.checked)} />recoverable delete · {path}</label>)}
          {selection.paths.length > 8 && <p role="alert">Select no more than 8 files before approving context.</p>}
        </div>
      )}
      {(run.approvedPaths.length > 0 ||
        run.approvedCreatePaths.length > 0 ||
        run.approvedDeletePaths.length > 0) && (
        <small>
          Approved context reads: {run.approvedPaths.join(", ") || "none"} · creates: {run.approvedCreatePaths.join(", ") || "none"} · recoverable deletes: {run.approvedDeletePaths.join(", ") || "none"}
        </small>
      )}
      {run.proposal && (
        <div className="agent-proposal">
          <strong>{run.proposal.summary}</strong>
          {run.proposal.files.map((file) => (
            <code key={file.path}>{file.operation} · {file.path}</code>
          ))}
        </div>
      )}
      {run.review && (
        <div className={run.review.approved ? "agent-approved" : "agent-rejected"}>
          {run.review.approved ? "Reviewer approved" : "Reviewer blocked"}: {run.review.summary}
        </div>
      )}
      {run.trash.length > 0 && (
        <div className="agent-proposal">
          <strong>Recoverable trash</strong>
          {run.trash.map((file) => (
            <code key={file.path}>{file.path} · {file.digest.slice(0, 12)}…</code>
          ))}
          <Button
            variant="default"
            disabled={busy}
            onClick={() => execute("restore-deleted")}
          >
            Approve restore once
          </Button>
        </div>
      )}
      {run.deployment && (
        <div className="agent-proposal">
          <strong>{run.deployment.target} review artifact · execution disabled</strong>
          <small>
            Workspace revision {run.deployment.workspaceRevision} · Tester evidence {run.deployment.testEvidenceHash.slice(0, 12)}…
          </small>
          {run.deployment.files.map((file) => (
            <code key={file.path}>
              {file.path} · {file.digest.slice(0, 12)}… · {file.bytes} bytes
            </code>
          ))}
        </div>
      )}
      {run.gitOperation && (
        <div className="agent-proposal">
          {run.gitOperation.recovery ? <>
            <strong>Repository state checked · {run.gitOperation.recovery.branch || "branch not set"}</strong>
            <code>Current HEAD: {run.gitOperation.recovery.head || "none"}</code>
            <small>{run.gitOperation.recovery.state === "clean" ? "Working tree is clean." : `${run.gitOperation.recovery.pendingChanges.length} pending changes.`} Checked {run.gitOperation.recovery.checkedAt}</small>
            {run.gitOperation.recovery.pendingChanges.map(file => <code key={file.path}>{file.status} · {file.path}{file.originalPath ? ` ← ${file.originalPath}` : ""}</code>)}
            <small>{run.gitOperation.recovery.previousOutcome === "process-reported-completed" ? "The prior process reported completion. This check does not prove that it produced the displayed HEAD." : "The prior operation's outcome is unknown. This is the repository state observed now."}</small>
          </> : <>
          <strong>
            {gitRecovery ? "Saved Git review" : `Local Git ${run.gitOperation.commit ? "commit" : "review"}`} ·{" "}
            {run.gitOperation.branch || "main"}
          </strong>
          <small>
            {run.gitOperation.message} · revision{" "}
            {run.gitOperation.workspaceRevision} · preview{" "}
            {run.gitOperation.previewDigest.slice(0, 12)}…
          </small>
          {run.gitOperation.files.map((file) => (
            <code key={file.path}>
              {file.operation} · {file.path} · {file.digest.slice(0, 12)}… · {file.bytes} bytes
            </code>
          ))}
          {run.gitOperation.commit && !gitRecovery && (
            <code>commit · {run.gitOperation.commit}</code>
          )}
          </>}
          <small>{run.gitOperation.boundary}</small>
        </div>
      )}
      {run.status === "plan_review" && (
        <Button disabled={busy} onClick={() => execute("approve-plan")}>
          Approve plan
        </Button>
      )}
      {run.status === "context_review" && (
        <Button disabled={busy || selection.paths.length > 8} onClick={() => execute("approve-context", selection)}>
          Approve context once · {selection.paths.length} reads + {selection.createPaths.length} creates + {selection.deletePaths.length} recoverable deletes
        </Button>
      )}
      {run.status === "proposal_generation" && (
        <Button disabled={busy} onClick={() => execute("generate-proposal")}>
          Approve model request once · generate + review
        </Button>
      )}
      {run.status === "diff_review" && !run.review?.approved && (
        <Button disabled={busy} onClick={() => execute("revise-proposal")}>
          Approve model request once · revise
        </Button>
      )}
      {run.status === "diff_review" && run.review?.approved && (
        <Button variant="default" disabled={busy} onClick={() => execute("apply")}>
          Approve write once
        </Button>
      )}
      {(run.status === "applied" || run.status === "restored") && (
        <Button variant="default" disabled={busy} onClick={() => execute("run-test")}>
          Approve build + test once
        </Button>
      )}
      {run.status === "tested" && (
        <>
          <div className="agent-approved">Tester passed with sandbox evidence.</div>
          <Button disabled={busy} onClick={() => execute("prepare-git")}>
            Prepare local Git commit review
          </Button>
          <Button disabled={busy} onClick={() => execute("prepare-deployment")}>
            Prepare deployment preview
          </Button>
        </>
      )}
      {gitRecovery && <Button disabled={busy} onClick={() => execute("reconcile-git")}>Check repository and recover</Button>}
      {run.status === "git_review" && !gitRecovery && (
        <Button
          variant="default"
          disabled={busy}
          onClick={() => execute("approve-git")}
        >
          Approve local Git commit once
        </Button>
      )}
      {run.status === "git_committed" && !gitRecovery && (
        <>
          <div className="agent-approved">
            Local commit created. No push, pull, PR, credential access or network
            request occurred.
          </div>
          <Button disabled={busy} onClick={() => execute("prepare-deployment")}>
            Prepare deployment preview
          </Button>
        </>
      )}
      {run.status === "deployment_review" && (
        <Button variant="default" disabled={busy} onClick={() => execute("approve-deployment")}>
          Approve deployment review once
        </Button>
      )}
      {run.status === "deployment_approved" && (
        <div className="agent-approved">
          Review approved. Execution remains disabled pending a separate Wallet-reviewed deployment flow.
        </div>
      )}
      {run.status === "restored" && (
        <div className="agent-approved">
          Deleted files were restored in a new workspace revision. Approve a new test before preparing further work.
        </div>
      )}
      {run.status === "test_failed" && (
        <>
          <div className="agent-rejected">
            Tester failed. The next fix remains reviewable and separately approved.
          </div>
          <Button disabled={busy} onClick={() => execute("generate-fix")}>
            Approve model request once · generate fix
          </Button>
        </>
      )}
    </div>
  );
}
