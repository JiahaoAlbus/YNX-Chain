import {
  Check,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  gitDiff,
  gitMutation,
  gitRemotePreview,
  gitStatus,
  type GitChange,
  type GitStatus,
} from "../runtime/client";

export function SourceControlPanel({
  projectId,
  revision,
  onWorkspaceChanged,
}: {
  projectId: string;
  revision: number;
  onWorkspaceChanged: (revision: number) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<GitStatus>(),
    [message, setMessage] = useState(""),
    [authorName, setAuthorName] = useState(
      () => localStorage.getItem("ynx-git-author") || "",
    ),
    [authorEmail, setAuthorEmail] = useState(
      () => localStorage.getItem("ynx-git-email") || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [diff, setDiff] = useState<{ path: string; text: string }>(),
    [branchName, setBranchName] = useState(""),
    [remoteUrl, setRemoteUrl] = useState(""),
    [remoteOperation, setRemoteOperation] = useState<"pull" | "push" | "create-pr">("push"),
    [targetBranch, setTargetBranch] = useState("main"),
    [remotePreview, setRemotePreview] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await gitStatus(projectId));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Git status failed.");
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const next = await gitMutation(projectId, body);
      setStatus(next);
      if (next.workspace) await onWorkspaceChanged(next.workspace.revision);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Git operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const workspaceMutation = (action: "checkout" | "merge", branch: string) =>
    mutate({
      action,
      branch,
      expectedRevision: revision,
      idempotencyKey: `git-${action}-${crypto.randomUUID()}`,
      ...(action === "merge" ? { authorName, authorEmail } : {}),
    });
  const deleteBranch = (branch: string) => {
    if (!window.confirm(`Delete local branch “${branch}”? This cannot be undone.`)) return;
    void mutate({
      action: "delete-branch",
      branch,
      approval: "delete-branch-once",
    });
  };
  const previewRemote = async () => {
    setBusy(true);
    setError("");
    try {
      const preview = await gitRemotePreview(projectId, {
        operation: remoteOperation,
        remoteUrl,
        branch: status?.branch || "main",
        ...(remoteOperation === "create-pr" ? { targetBranch } : {}),
      });
      setRemotePreview(`${preview.previewDigest.slice(0, 16)} · ${preview.message}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Remote preview failed.");
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    localStorage.setItem("ynx-git-author", authorName);
    localStorage.setItem("ynx-git-email", authorEmail);
    await mutate({ action: "commit", message, authorName, authorEmail });
    setMessage("");
  };
  const showDiff = async (change: GitChange, scope: "working" | "staged") => {
    try {
      setDiff({
        path: change.path,
        text: await gitDiff(projectId, change.path, scope),
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Diff failed.");
    }
  };
  if (!status)
    return (
      <section className="scm-panel">
        <header>
          <strong>SOURCE CONTROL</strong>
        </header>
        <div className="honest-boundary">
          Connecting to the isolated Git broker…
        </div>
      </section>
    );
  if (!status.initialized)
    return (
      <section className="scm-panel">
        <header>
          <strong>SOURCE CONTROL</strong>
        </header>
        <div className="scm-onboarding">
          <GitCommitHorizontal />
          <strong>No repository yet</strong>
          <p>
            Initialize a persistent, user-isolated Git object database for this
            workspace.
          </p>
          <button disabled={busy} onClick={() => mutate({ action: "init" })}>
            Initialize Repository
          </button>
          {error && <small>{error}</small>}
        </div>
      </section>
    );
  const staged = status.changes.filter(
      (change) => change.indexStatus !== " " && change.indexStatus !== "?",
    ),
    working = status.changes.filter((change) => change.worktreeStatus !== " ");
  return (
    <section className="scm-panel">
      <header>
        <strong>SOURCE CONTROL</strong>
        <button onClick={refresh} title="Refresh status">
          <RefreshCw />
        </button>
      </header>
      <div className="scm-branch">
        branch <strong>{status.branch}</strong>
      </div>
      <details className="scm-branches">
        <summary>
          BRANCHES <span>{status.branches?.length || 0}</span>
        </summary>
        {(status.branches || []).map((branch) => (
          <div className="scm-branch-row" key={branch.name}>
            <span><GitBranch /> {branch.name}</span>
            {branch.name !== status.branch && (
              <>
                <button disabled={busy} onClick={() => workspaceMutation("checkout", branch.name)}>Switch</button>
                <button disabled={busy} title={`Merge ${branch.name}`} onClick={() => workspaceMutation("merge", branch.name)}><GitMerge /></button>
                <button disabled={busy} title={`Delete ${branch.name}`} onClick={() => deleteBranch(branch.name)}>×</button>
              </>
            )}
          </div>
        ))}
        <div className="scm-inline-form">
          <input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="new-branch" aria-label="New branch name" />
          <button disabled={busy || !branchName.trim()} onClick={async () => { await mutate({ action: "create-branch", branch: branchName }); setBranchName(""); }}>Create</button>
        </div>
      </details>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Commit message"
        aria-label="Commit message"
      />
      <details open>
        <summary>
          STAGED CHANGES <span>{staged.length}</span>
        </summary>
        {staged.map((change) => (
          <Change
            key={`s:${change.path}`}
            change={change}
            onOpen={() => showDiff(change, "staged")}
            actionTitle="Unstage"
            onAction={() => mutate({ action: "unstage", paths: [change.path] })}
            icon={<Minus />}
          />
        ))}
      </details>
      <details open>
        <summary>
          CHANGES <span>{working.length}</span>
        </summary>
        {working.map((change) => (
          <Change
            key={`w:${change.path}`}
            change={change}
            onOpen={() => showDiff(change, "working")}
            actionTitle="Stage"
            onAction={() => mutate({ action: "stage", paths: [change.path] })}
            icon={<Plus />}
          />
        ))}
      </details>
      <div className="scm-identity">
        <input
          value={authorName}
          onChange={(event) => setAuthorName(event.target.value)}
          placeholder="Author name"
          aria-label="Git author name"
        />
        <input
          value={authorEmail}
          onChange={(event) => setAuthorEmail(event.target.value)}
          placeholder="author@example.com"
          aria-label="Git author email"
        />
      </div>
      <button
        className="scm-commit"
        disabled={busy || !message.trim() || staged.length === 0}
        onClick={commit}
      >
        <Check /> Commit staged changes
      </button>
      {error && <small className="scm-error">{error}</small>}
      {diff && (
        <div className="scm-diff">
          <header>
            <strong>{diff.path}</strong>
            <button onClick={() => setDiff(undefined)}>×</button>
          </header>
          <pre>{diff.text || "No textual diff."}</pre>
        </div>
      )}
      <details>
        <summary>
          COMMITS <span>{status.commits.length}</span>
        </summary>
        {status.commits.map((commit) => (
          <div className="scm-commit-row" key={commit.hash}>
            <strong>{commit.subject}</strong>
            <span>
              {commit.shortHash} · {commit.author}
            </span>
          </div>
        ))}
      </details>
      <details className="scm-remote">
        <summary>REMOTE INTENT PREVIEW</summary>
        <p>No credentials are stored in the browser. Previewing never performs a network request.</p>
        <select value={remoteOperation} onChange={(event) => setRemoteOperation(event.target.value as typeof remoteOperation)} aria-label="Remote operation">
          <option value="pull">Pull</option>
          <option value="push">Push</option>
          <option value="create-pr">Create PR</option>
        </select>
        <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/org/repo.git" aria-label="HTTPS Git remote" />
        {remoteOperation === "create-pr" && <input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} placeholder="target branch" aria-label="PR target branch" />}
        <button disabled={busy || !remoteUrl.trim()} onClick={previewRemote}>Preview intent</button>
        {remotePreview && <small>{remotePreview}</small>}
      </details>
    </section>
  );
}
function Change({
  change,
  onOpen,
  onAction,
  actionTitle,
  icon,
}: {
  change: GitChange;
  onOpen: () => void;
  onAction: () => void;
  actionTitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="scm-change">
      <button onClick={onOpen}>
        <span>{change.path}</span>
        <b>{change.status.trim() || change.status}</b>
      </button>
      <button title={actionTitle} onClick={onAction}>
        {icon}
      </button>
    </div>
  );
}
