import {
  Check,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  gitDiff,
  gitMutation,
  gitStatus,
  type GitChange,
  type GitStatus,
} from "../runtime/client";

export function SourceControlPanel({ projectId }: { projectId: string }) {
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
    [diff, setDiff] = useState<{ path: string; text: string }>();
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
      setStatus(await gitMutation(projectId, body));
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Git operation failed.",
      );
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
