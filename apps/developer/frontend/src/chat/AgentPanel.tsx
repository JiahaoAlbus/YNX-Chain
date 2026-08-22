import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import {
  agentAction,
  clearProjectMemory,
  createAgentRun,
  exportProjectMemory,
  indexProjectMemory,
  loadModelCatalog,
  loadProjectMemoryFacts,
  loadProjectMemory,
  searchProjectMemory,
  type AgentRun,
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
  | "prepare-deployment"
  | "approve-deployment";

export function AgentPanel({
  projectId,
  revision,
  activePath,
  onApplied,
}: {
  projectId: string;
  revision: number;
  activePath: string;
  onApplied: (revision: number) => void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [run, setRun] = useState<AgentRun>();
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

  const loadCatalog = async () => {
    setBusy(true);
    setError("");
    try {
      setCatalog(await loadModelCatalog());
    } catch (error) {
      setCatalog(undefined);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
    setMemoryFacts([]);
    loadProjectMemory(projectId).then(setMemory).catch(() => {});
  }, [projectId]);

  const execute = async (action: AgentAction) => {
    setBusy(true);
    setError("");
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
        });
      } else {
        next = await agentAction(run!.runId, {
          action,
          provider,
          model: model || undefined,
          apiKey,
          approvalId,
          ...(action === "approve-context"
            ? {
                paths: run!.plan?.contextPaths || [],
                createPaths: run!.plan?.createPaths || [],
                deletePaths: run!.plan?.deletePaths || [],
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
        });
      }
      setRun(next);
      if (action === "apply" || action === "restore-deleted")
        onApplied(next.workspaceRevision);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (keyRef.current) keyRef.current.value = "";
      setBusy(false);
    }
  };

  const needsKey = provider !== "ynx-hosted";
  const providerReady =
    provider !== "ynx-hosted" || catalog?.hosted.available === true;
  const buildMemory = async () => {
    setBusy(true);
    setError("");
    try {
      setMemory(await indexProjectMemory(projectId, revision));
      setMemoryFacts([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const searchMemory = async () => {
    setBusy(true);
    setError("");
    try {
      setMemoryResults((await searchProjectMemory(projectId, memoryQuery)).results);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const exportMemory = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await exportProjectMemory(projectId);
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
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const viewMemoryFacts = async () => {
    if (memory?.revision == null) return;
    setBusy(true);
    setError("");
    try {
      setMemoryFacts(await loadProjectMemoryFacts(projectId, memory.revision));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const clearMemory = async () => {
    if (
      !window.confirm(
        "Clear this project memory index? The workspace files are not deleted.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await clearProjectMemory(projectId, memory?.revision ?? null);
      setMemory(await loadProjectMemory(projectId));
      setMemoryResults([]);
      setMemoryFacts([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
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
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Model (provider default)"
        />
        {needsKey && (
          <input
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
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Describe the software change and acceptance criteria…"
          />
          <Button
            variant="default"
            disabled={busy || !providerReady || intent.trim().length < 4}
            onClick={() => execute("create")}
          >
            Approve model request once · create plan
          </Button>
        </>
      ) : (
        <AgentRunView run={run} busy={busy} execute={execute} />
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
  execute: (action: AgentAction) => void;
}) {
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
          {run.plan?.contextPaths.map((path) => <code key={path}>read · {path}</code>)}
          {run.plan?.createPaths.map((path) => <code key={path}>create · {path}</code>)}
          {run.plan?.deletePaths.map((path) => <code key={path}>recoverable delete · {path}</code>)}
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
          <strong>
            Local Git {run.gitOperation.commit ? "commit" : "review"} ·{" "}
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
          {run.gitOperation.commit && (
            <code>commit · {run.gitOperation.commit}</code>
          )}
          <small>{run.gitOperation.boundary}</small>
        </div>
      )}
      {run.status === "plan_review" && (
        <Button disabled={busy} onClick={() => execute("approve-plan")}>
          Approve plan
        </Button>
      )}
      {run.status === "context_review" && (
        <Button disabled={busy} onClick={() => execute("approve-context")}>
          Approve context once · {run.plan?.contextPaths.length || 0} reads + {run.plan?.createPaths.length || 0} creates + {run.plan?.deletePaths.length || 0} recoverable deletes
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
      {run.status === "applied" && (
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
      {run.status === "git_review" && (
        <Button
          variant="default"
          disabled={busy}
          onClick={() => execute("approve-git")}
        >
          Approve local Git commit once
        </Button>
      )}
      {run.status === "git_committed" && (
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
          Deleted files were restored in a new workspace revision. Start a new reviewed run before further changes.
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
