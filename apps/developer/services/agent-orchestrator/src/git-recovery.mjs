// Observe an interrupted local commit without repeating any Git mutation.
// workspaceOwner is an internal binding supplied with the owner-scoped run;
// it is deliberately not inferred from project IDs or repository contents.
export async function inspectAgentGitRecovery({ owner, run, workspaceStore, gitService, signal, assertCurrent }) {
  async function checkCurrent() {
    if (signal?.aborted) throw cancellation(signal);
    if (typeof assertCurrent !== "function")
      throw fault("Git recovery requires the current workspace identity.", "agent_identity_verifier_required", 503);
    if (await assertCurrent() === false)
      throw fault("The workspace identity changed. Sign in again before continuing.", "agent_identity_changed", 401);
    if (signal?.aborted) throw cancellation(signal);
  }

  await checkCurrent();
  if (typeof owner !== "string" || !owner || run?.workspaceOwner !== owner)
    throw fault("Agent run not found.", "agent_run_not_found", 404);
  if (run.status !== "git_review" || run.operation?.status !== "interrupted" || run.operation.action !== "approve-git" || !run.gitOperation)
    throw fault("Only an interrupted local Git approval can be inspected.", "agent_git_recovery_unavailable", 409);
  if (typeof gitService?.runForOwner !== "function")
    throw fault("The reviewed local Git adapter is unavailable.", "git_adapter_unavailable", 503);
  const testEvent = run.events?.findLast(event => event.event_type === "tester.completed");
  if (testEvent?.payload?.result?.ok !== true || !testEvent.event_hash ||
      run.gitOperation.testEvidenceHash !== testEvent.event_hash ||
      run.gitOperation.projectId !== run.projectId || run.gitOperation.workspaceRevision !== run.workspaceRevision)
    throw fault("Passing Tester evidence for this workspace revision is required.", "git_test_evidence_required", 409);

  function readWorkspace() {
    const workspace = workspaceStore.get(owner, run.projectId);
    if (!workspace) throw fault("Workspace not found.", "workspace_not_found", 404);
    if (workspaceStore.storageMode?.(owner, run.projectId) === "native-volume")
      throw fault("This project uses native workspace files. Open its native IDE Tools to inspect Git.", "agent_native_tools_required", 409);
    if (workspace.revision !== run.workspaceRevision)
      throw fault("The workspace changed after the saved Git review.", "git_preview_stale", 409);
    return workspace;
  }

  readWorkspace();
  await checkCurrent();
  const observed = await gitService.runForOwner(owner, run.projectId, null, { signal, assertCurrent });
  await checkCurrent();
  const workspace = readWorkspace();
  if (!observed || typeof observed.initialized !== "boolean" || !Array.isArray(observed.changes))
    throw fault("Local Git returned an invalid status.", "git_status_invalid", 502);
  const pendingChanges = observed.initialized
    ? observed.changes.map(change => ({ ...change }))
    : Object.keys(workspace.files).sort().map(path => ({ path, status: "??", indexStatus: "?", worktreeStatus: "?" }));
  return {
    status: "tested",
    gitOperation: {
      ...run.gitOperation,
      executed: false,
      recovery: {
        state: observed.initialized && pendingChanges.length === 0 ? "clean" : "pending-changes",
        head: observed.head || null,
        branch: observed.branch || null,
        pendingChanges,
        checkedAt: new Date().toISOString(),
        previousOutcome: run.operation.recoveryEvidence?.completedOperation === "commit-reviewed" ? "process-reported-completed" : "unknown",
      },
    },
  };
}

function cancellation(signal) {
  return signal.reason instanceof Error ? signal.reason : fault("The request was cancelled.", "agent_request_cancelled", 499);
}
function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
