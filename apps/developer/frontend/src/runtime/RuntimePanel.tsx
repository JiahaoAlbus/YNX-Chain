import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { createContainerLease, inspectSshTarget, loadProjectEnvironment, loadRuntimeProfiles, loadTaskActivities, loadTerminalSessions, removeContainerLease, removeSshProfile, saveSshProfile, saveProjectEnvironment, stopTaskActivity, stopTerminalSession, type EnvironmentEntry, type ProjectEnvironment, type RuntimeProfiles, type TaskActivity, type TerminalSession } from "./client";

export function RuntimePanel({ projectId, selected, onSelect }: { projectId: string; selected?: string; onSelect: (runtimeId: string | undefined) => void }) {
  const [data, setData] = useState<RuntimeProfiles>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [host, setHost] = useState(""),
    [port, setPort] = useState(22),
    [user, setUser] = useState(""),
    [label, setLabel] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [inspection, setInspection] = useState<{
      hostKey: string;
      fingerprint: string;
    }>();
  const refresh = () =>
    loadRuntimeProfiles()
      .then(setData)
      .catch((value) => setError(value.message));
  useEffect(() => {
    void refresh();
  }, []);
  const action = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Runtime operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const inspect = () => action(async () => setInspection(await inspectSshTarget(host, port, user)));
  const save = () =>
    inspection &&
    action(async () => {
      await saveSshProfile({
        host,
        port,
        user,
        label,
        privateKey,
        reviewedHostKey: inspection.hostKey,
      });
      setPrivateKey("");
      setInspection(undefined);
    });
  const selectedSsh = selected?.startsWith("ssh-");
  return (
    <section className="side-section runtime-panel">
      <header>
        <strong>REMOTE EXPLORER</strong>
        <span>{selectedSsh ? "SSH selected" : selected ? "container selected" : data?.container.ready ? "LXD ready" : "local only"}</span>
      </header>
      <div className="runtime-block">
        <strong>CLOUD WORKSPACES</strong>
        <p>Isolated Ubuntu 24.04 runtimes use 2 CPU, 2 GiB RAM, a 10 GiB volume and no network device by default.</p>
        <Button disabled={busy || !data?.container.ready} onClick={() => action(() => createContainerLease(projectId))}>
          Create isolated workspace
        </Button>
        {data?.leases.map((item) => (
          <div className="runtime-row" key={item.runtimeId}>
            <span>
              <b>{item.projectId}</b>
              <small>
                {item.runtimeId.slice(0, 10)} · {item.status}
              </small>
            </span>
            <div>
              <Button variant={selected === item.runtimeId ? "default" : "secondary"} onClick={() => onSelect(selected === item.runtimeId ? undefined : item.runtimeId)}>
                {selected === item.runtimeId ? "Using" : "Use"}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  action(async () => {
                    if (selected === item.runtimeId) onSelect(undefined);
                    await removeContainerLease(item.runtimeId);
                  })
                }
              >
                Stop
              </Button>
            </div>
          </div>
        ))}
      </div>
      <EnvironmentAndProcesses projectId={projectId} />
      <div className="runtime-block">
        <strong>REMOTE SSH</strong>
        <p>Public hosts only. Review the host fingerprint before the private key is encrypted and tested. Opening a profile synchronizes this project into its own remote workspace.</p>
        <label>
          Host
          <input
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
              setInspection(undefined);
            }}
            placeholder="code.example.com"
          />
        </label>
        <div className="runtime-target">
          <label>
            User
            <input value={user} onChange={(event) => setUser(event.target.value)} placeholder="developer" />
          </label>
          <label>
            Port
            <input type="number" value={port} onChange={(event) => setPort(Number(event.target.value))} />
          </label>
        </div>
        <Button variant="secondary" disabled={busy || !host || !user} onClick={inspect}>
          Inspect host key
        </Button>
        {inspection && (
          <div className="host-review">
            <strong>Verify this fingerprint</strong>
            <code>{inspection.fingerprint}</code>
            <label>
              Profile label
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`${user}@${host}`} />
            </label>
            <label>
              OpenSSH private key
              <textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} placeholder="Paste key from your local secure file" />
            </label>
            <Button disabled={busy || privateKey.length < 64} onClick={save}>
              Approve, verify and save
            </Button>
          </div>
        )}
        {data?.sshProfiles.map((item) => {
          const runtimeId = `ssh-${item.profileId}`;
          return (
            <div className="runtime-row" key={item.profileId}>
              <span>
                <b>{item.label}</b>
                <small>
                  {item.user}@{item.host}:{item.port}
                  <br />
                  {item.fingerprint}
                </small>
              </span>
              <div>
                <Button variant={selected === runtimeId ? "default" : "secondary"} onClick={() => onSelect(selected === runtimeId ? undefined : runtimeId)}>
                  {selected === runtimeId ? "Open" : "Use"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    action(async () => {
                      if (selected === runtimeId) onSelect(undefined);
                      await removeSshProfile(item.profileId);
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <div className="collab-error">{error}</div>}
      <div className="honest-boundary">Remote SSH uses the reviewed host key on every connection. The encrypted private key never returns to the browser. AI, extensions, packages and deployment still require separate approvals.</div>
    </section>
  );
}

function EnvironmentAndProcesses({ projectId }: { projectId: string }) {
  const [environment, setEnvironment] = useState<ProjectEnvironment>(),
    [entries, setEntries] = useState<EnvironmentEntry[]>([]),
    [terminals, setTerminals] = useState<TerminalSession[]>([]),
    [tasks, setTasks] = useState<TaskActivity[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => {
    const [nextEnvironment, nextTerminals, nextTasks] = await Promise.all([loadProjectEnvironment(projectId), loadTerminalSessions(projectId), loadTaskActivities(projectId)]);
    setEnvironment(nextEnvironment);
    setEntries(nextEnvironment.entries);
    setTerminals(nextTerminals);
    setTasks(nextTasks);
  };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [nextEnvironment, nextTerminals, nextTasks] = await Promise.all([loadProjectEnvironment(projectId), loadTerminalSessions(projectId), loadTaskActivities(projectId)]);
        if (active) {
          setEnvironment(nextEnvironment);
          setEntries(nextEnvironment.entries);
          setTerminals(nextTerminals);
          setTasks(nextTasks);
          setError("");
        }
      } catch (value) {
        if (active) setError(value instanceof Error ? value.message : "Project runtime state could not load.");
      }
    };
    void poll();
    const timer = window.setInterval(
      () =>
        void Promise.all([loadTerminalSessions(projectId), loadTaskActivities(projectId)])
          .then(([nextTerminals, nextTasks]) => {
            if (active) {
              setTerminals(nextTerminals);
              setTasks(nextTasks);
            }
          })
          .catch(() => {}),
      5_000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId]);
  const change = (index: number, value: Partial<EnvironmentEntry>) => setEntries((current) => current.map((entry, item) => (item === index ? ({ ...entry, ...value } as EnvironmentEntry) : entry)));
  const save = async () => {
    if (!environment) return;
    setBusy(true);
    setError("");
    try {
      const saved = await saveProjectEnvironment(projectId, environment.revision, entries);
      setEnvironment(saved);
      setEntries(saved.entries);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Environment could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="runtime-block">
        <strong>PROJECT ENVIRONMENT</strong>
        <p>Saved per project and applied to new terminals and reviewed tasks. Literal values must be non-sensitive. For secrets, save only a broker reference—never paste a Secret value here.</p>
        {entries.map((entry, index) => (
          <div className="environment-row" key={`${entry.key}:${index}`}>
            <input aria-label={`Environment key ${index + 1}`} value={entry.key} onChange={(event) => change(index, { key: event.target.value })} placeholder="PUBLIC_ORIGIN" />
            <select aria-label={`Environment type ${index + 1}`} value={entry.kind} onChange={(event) => change(index, event.target.value === "literal" ? { kind: "literal", value: "" } : { kind: "secret-reference", reference: "" })}>
              <option value="literal">Non-sensitive value</option>
              <option value="secret-reference">Secret reference</option>
            </select>
            <input aria-label={`Environment value ${index + 1}`} value={entry.kind === "literal" ? entry.value : entry.reference} onChange={(event) => change(index, entry.kind === "literal" ? { value: event.target.value } : { reference: event.target.value })} placeholder={entry.kind === "literal" ? "https://example.test" : "vault://team/name"} />
            <Button variant="ghost" onClick={() => setEntries((current) => current.filter((_, item) => item !== index))}>
              Remove
            </Button>
          </div>
        ))}
        <div className="runtime-actions">
          <Button variant="secondary" disabled={entries.length >= 32} onClick={() => setEntries((current) => [...current, { key: "", kind: "literal", value: "" }])}>
            Add variable
          </Button>
          <Button disabled={busy || !environment} onClick={save}>
            Save environment
          </Button>
        </div>
        <small>
          Revision {environment?.revision ?? "—"}
          {environment?.updatedAt ? ` · ${new Date(environment.updatedAt).toLocaleString()}` : ""}
        </small>
      </div>
      <div className="runtime-block">
        <strong>RUNTIME PROCESSES</strong>
        <p>This live inventory is driven by the task queue and terminal supervisor. It exposes state and bounds, never commands or environment values.</p>
        {terminals.length === 0 && tasks.length === 0 && <small>No active terminal or task processes.</small>}
        {tasks.map((task) => (
          <div className="runtime-row" key={task.taskId}>
            <span>
              <b>{task.kind === "test-project" ? "Project tests" : "Build / run"}</b>
              <small>
                {task.status} · env r{task.environmentRevision ?? "resolving"}
                <br />
                {task.startedAt ? `started ${new Date(task.startedAt).toLocaleTimeString()}` : `queued ${new Date(task.queuedAt).toLocaleTimeString()}`}
              </small>
            </span>
            <Button
              variant="ghost"
              disabled={busy || task.status === "stopping"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await stopTaskActivity(task.taskId);
                  await refresh();
                } catch (value) {
                  setError(value instanceof Error ? value.message : "Task could not stop.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Stop
            </Button>
          </div>
        ))}
        {terminals.map((terminal) => (
          <div className="runtime-row" key={terminal.sessionId}>
            <span>
              <b>{terminal.status}</b>
              <small>
                {terminal.runtimeId ? (terminal.runtimeId.startsWith("ssh-") ? "Remote SSH" : "LXD container") : "Local sandbox"} · env r{terminal.environmentRevision}
                <br />
                started {new Date(terminal.startedAt).toLocaleTimeString()} · replay {Math.ceil(terminal.replayBytes / 1024)} KiB
              </small>
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await stopTerminalSession(terminal.sessionId);
                  await refresh();
                } catch (value) {
                  setError(value instanceof Error ? value.message : "Terminal could not stop.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Stop
            </Button>
          </div>
        ))}
      </div>
      {error && <div className="collab-error">{error}</div>}
    </>
  );
}
