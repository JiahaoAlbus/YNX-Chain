import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PROTOCOL = "ynx-code-agent/v1",
  MAX_BODY = 640 * 1024;
export function createAgentOrchestrator({
  filename,
  ownerForRequest,
  workspaceStore,
  modelRouter,
  projectMemory,
  workspaceRuntime,
  gitService,
}) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agent_runs(owner_id TEXT NOT NULL,run_id TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,intent TEXT NOT NULL,workspace_revision INTEGER NOT NULL,plan TEXT,approved_paths TEXT NOT NULL DEFAULT '[]',approved_create_paths TEXT NOT NULL DEFAULT '[]',approved_delete_paths TEXT NOT NULL DEFAULT '[]',proposal TEXT,review TEXT,deployment TEXT,git_operation TEXT,trash TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,run_id)); CREATE TABLE IF NOT EXISTS agent_events(owner_id TEXT NOT NULL,run_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_type TEXT NOT NULL,payload TEXT NOT NULL,previous_hash TEXT NOT NULL,event_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,run_id,sequence)); CREATE TABLE IF NOT EXISTS agent_approvals(owner_id TEXT NOT NULL,approval_id TEXT NOT NULL,permission TEXT NOT NULL,run_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,approval_id));",
  );
  if (
    !db
      .prepare("PRAGMA table_info(agent_runs)")
      .all()
      .some((column) => column.name === "deployment")
  )
    db.exec("ALTER TABLE agent_runs ADD COLUMN deployment TEXT");
  if (
    !db
      .prepare("PRAGMA table_info(agent_runs)")
      .all()
      .some((column) => column.name === "approved_create_paths")
  )
    db.exec(
      "ALTER TABLE agent_runs ADD COLUMN approved_create_paths TEXT NOT NULL DEFAULT '[]'",
    );
  for (const [column, definition] of [
    ["approved_delete_paths", "TEXT NOT NULL DEFAULT '[]'"],
    ["trash", "TEXT NOT NULL DEFAULT '[]'"],
    ["git_operation", "TEXT"],
  ])
    if (
      !db
        .prepare("PRAGMA table_info(agent_runs)")
        .all()
        .some((item) => item.name === column)
    )
      db.exec(`ALTER TABLE agent_runs ADD COLUMN ${column} ${definition}`);
  const getRun = db.prepare(
      "SELECT * FROM agent_runs WHERE owner_id=? AND run_id=?",
    ),
    listRuns = db.prepare(
      "SELECT * FROM agent_runs WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50",
    ),
    insertRun = db.prepare(
      "INSERT INTO agent_runs(owner_id,run_id,project_id,status,provider,model,intent,workspace_revision,plan,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ),
    updateRun = db.prepare(
      "UPDATE agent_runs SET status=?,provider=?,model=?,plan=?,approved_paths=?,approved_create_paths=?,approved_delete_paths=?,proposal=?,review=?,deployment=?,git_operation=?,trash=?,workspace_revision=?,updated_at=? WHERE owner_id=? AND run_id=?",
    ),
    lastEvent = db.prepare(
      "SELECT sequence,event_hash FROM agent_events WHERE owner_id=? AND run_id=? ORDER BY sequence DESC LIMIT 1",
    ),
    insertEvent = db.prepare(
      "INSERT INTO agent_events(owner_id,run_id,sequence,event_type,payload,previous_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ),
    events = db.prepare(
      "SELECT sequence,event_type,payload,previous_hash,event_hash,created_at FROM agent_events WHERE owner_id=? AND run_id=? ORDER BY sequence",
    ),
    getApproval = db.prepare(
      "SELECT permission,run_id FROM agent_approvals WHERE owner_id=? AND approval_id=?",
    ),
    insertApproval = db.prepare(
      "INSERT INTO agent_approvals(owner_id,approval_id,permission,run_id,created_at) VALUES(?,?,?,?,?)",
    );
  const append = (owner, runId, type, payload) => {
    const previous = lastEvent.get(owner, runId),
      sequence = Number(previous?.sequence || 0) + 1,
      previousHash = previous?.event_hash || "0".repeat(64),
      serialized = stable(payload),
      eventHash = createHash("sha256")
        .update(`${previousHash}:${sequence}:${type}:${serialized}`)
        .digest("hex"),
      createdAt = new Date().toISOString();
    insertEvent.run(
      owner,
      runId,
      sequence,
      type,
      serialized,
      previousHash,
      eventHash,
      createdAt,
    );
    return eventHash;
  };
  const read = (owner, runId) => {
    const row = getRun.get(owner, runId);
    return row ? record(row, events.all(owner, runId)) : null;
  };
  async function handler(request, response) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (!url.pathname.startsWith("/runtime/agent/runs")) return false;
    const owner = ownerForRequest(request);
    if (!owner)
      return (
        json(response, 401, {
          error: "A signed workspace session is required.",
          code: "workspace_session_required",
        }),
        true
      );
    const clientController = new AbortController(),
      abortClient = () => clientController.abort();
    request.once("aborted", abortClient);
    response.once("close", () => {
      if (!response.writableEnded) abortClient();
    });
    try {
      const id = url.pathname.split("/")[4] || "";
      if (request.method === "GET") {
        if (id) {
          const run = read(owner, id);
          if (!run)
            throw fault("Agent run not found.", "agent_run_not_found", 404);
          json(response, 200, { protocolVersion: PROTOCOL, run });
        } else {
          const projectId = validId(
            url.searchParams.get("projectId"),
            "project",
          );
          json(response, 200, {
            protocolVersion: PROTOCOL,
            runs: listRuns.all(owner, projectId).map((row) => record(row, [])),
          });
        }
        return true;
      }
      if (request.method !== "POST")
        throw fault("Method not allowed.", "method_not_allowed", 405);
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      Object.defineProperty(body, "requestSignal", {
        value: clientController.signal,
        enumerable: false,
      });
      if (body.protocolVersion !== PROTOCOL)
        throw fault(
          "Agent protocol version is required.",
          "protocol_mismatch",
          400,
        );
      if (!id) {
        const projectId = validId(body.projectId, "project"),
          intent = text(body.intent, 4, 12000, "intent"),
          workspace = workspaceStore.get(owner, projectId),
          runId = randomUUID();
        if (!workspace)
          throw fault("Workspace not found.", "workspace_not_found", 404);
        if (body.approval !== "model-request-once")
          throw fault(
            "One-time model request approval is required.",
            "model_request_approval_required",
            403,
          );
        claimApproval(
          owner,
          body.approvalId,
          "model-network",
          runId,
          getApproval,
          insertApproval,
        );
        const model = await modelRouter.generate(
            modelInput(
              body,
              "Planner",
              `Create a concise implementation plan for this request. Return JSON only as {\"summary\":string,\"steps\":[{\"title\":string,\"acceptance\":string}],\"contextPaths\":[string],\"createPaths\":[string],\"deletePaths\":[string]}. contextPaths must name existing files to read. createPaths must name only necessary new files. deletePaths must name existing files whose removal is necessary and recoverable. Available paths: ${Object.keys(workspace.files).join(", ")}\nRequest: ${intent}`,
              clientController.signal,
            ),
          ),
          plan = validatePlan(parseJson(model.text), workspace.files),
          now = new Date().toISOString();
        insertRun.run(
          owner,
          runId,
          projectId,
          "plan_review",
          model.provider,
          model.model,
          intent,
          workspace.revision,
          stable(plan),
          now,
          now,
        );
        append(owner, runId, "planner.completed", {
          ...modelEvidence(model),
          approval: "model-request-once",
          approvalId: body.approvalId,
          plan,
        });
        json(response, 201, {
          protocolVersion: PROTOCOL,
          run: read(owner, runId),
        });
        return true;
      }
      const current = read(owner, id);
      if (!current)
        throw fault("Agent run not found.", "agent_run_not_found", 404);
      const workspace = workspaceStore.get(owner, current.projectId);
      if (!workspace)
        throw fault("Workspace not found.", "workspace_not_found", 404);
      if (body.action === "approve-plan") {
        requireState(current, "plan_review");
        persist({ ...current, status: "context_review" });
        append(owner, id, "plan.approved", { approval: "explicit" });
      } else if (body.action === "approve-context") {
        requireState(current, "context_review");
        const paths = validatePaths(body.paths, workspace.files),
          createPaths = validateCreatePaths(
            body.createPaths || [],
            workspace.files,
          ),
          deletePaths = validatePaths(
            body.deletePaths || [],
            workspace.files,
          );
        authorize(
          "read-context",
          "context-read-once",
          "One-time context read approval is required.",
          "context_read_approval_required",
        );
        persist({
          ...current,
          status: "proposal_generation",
          approvedPaths: paths,
          approvedCreatePaths: createPaths,
          approvedDeletePaths: deletePaths,
        });
        append(owner, id, "context.approved", {
          paths,
          createPaths,
          deletePaths,
          digests: Object.fromEntries(
            paths.map((path) => [path, sha(workspace.files[path])]),
          ),
        });
      } else if (body.action === "generate-proposal") {
        requireState(current, "proposal_generation");
        authorize(
          "model-network",
          "model-request-once",
          "One-time model request approval is required.",
          "model_request_approval_required",
        );
        const context = current.approvedPaths
            .map(
              (path) =>
                `--- ${path} sha256=${sha(workspace.files[path])} ---\n${workspace.files[path]}`,
            )
            .join("\n"),
          memory = projectMemory
            ? await projectMemory
                .search(
                  owner,
                  current.projectId,
                  current.intent,
                  8,
                  current.approvedPaths,
                )
                .catch(() => null)
            : null,
          memoryContext =
            memory?.indexedRevision === workspace.revision
              ? memory.results.map((result) => result.content).join("\n")
              : "",
          generated = await generateValidatedProposal(
            modelRouter,
            body,
            `Implement the approved plan. Return JSON only as {\"summary\":string,\"edits\":[{\"path\":string,\"expectedDigest\":string,\"replacements\":[{\"find\":string,\"replace\":string}]}],\"creates\":[{\"path\":string,\"content\":string}],\"deletes\":[{\"path\":string,\"expectedDigest\":string}]}. Use exact non-empty find text that occurs once. Only create or delete explicitly approved paths. Deletes are recoverable from server-side trash. Keep the response compact; never return unchanged files.\nPlan: ${stable(current.plan)}\nApproved semantic memory:\n${memoryContext}\nApproved context:\n${context}`,
            workspace.files,
            current.approvedPaths,
            current.approvedCreatePaths,
            current.approvedDeletePaths,
          ),
          coder = generated.coder,
          proposal = generated.proposal,
          reviewed = await generateValidatedReview(
            modelRouter,
            body,
            `Review this proposed patch for correctness, security, and missing tests. Return JSON only as {\"approved\":boolean,\"summary\":string,\"findings\":[string]}.\nIntent: ${current.intent}\nProposal: ${stable(proposal)}`,
          ),
          review = reviewed.review;
        persist({
          ...current,
          status: "diff_review",
          proposal,
          review,
          provider: coder.provider,
          model: coder.model,
        });
        append(owner, id, "coder.proposed", {
          ...modelEvidence(coder),
          memoryRevision: memory?.indexedRevision ?? null,
          validationAttempts: generated.attempts,
          files: proposal.files.map((file) => ({
            path: file.path,
            operation: file.operation,
            digest: sha(file.content),
            bytes: Buffer.byteLength(file.content),
          })),
        });
        append(owner, id, "reviewer.completed", {
          ...modelEvidence(reviewed.reviewer),
          ...review,
          validationAttempts: reviewed.attempts,
        });
      } else if (body.action === "revise-proposal") {
        requireState(current, "diff_review");
        if (current.review?.approved)
          throw fault(
            "Only a Reviewer-blocked proposal can be revised.",
            "revision_not_required",
            409,
          );
        authorize(
          "model-network",
          "model-request-once",
          "One-time model request approval is required.",
          "model_request_approval_required",
        );
        const context = current.approvedPaths
            .map(
              (path) =>
                `--- ${path} sha256=${sha(workspace.files[path])} ---\n${workspace.files[path]}`,
            )
            .join("\n"),
          generated = await generateValidatedProposal(
            modelRouter,
            body,
            `Revise the rejected patch to satisfy the user intent and every Reviewer finding. Preserve all unrelated imports, declarations, and behavior. Prefer the smallest exact replacement. Return JSON only as {"summary":string,"edits":[{"path":string,"expectedDigest":string,"replacements":[{"find":string,"replace":string}]}],"creates":[{"path":string,"content":string}],"deletes":[{"path":string,"expectedDigest":string}]}.\nIntent: ${current.intent}\nRejected proposal: ${stable(current.proposal)}\nReviewer: ${stable(current.review)}\nApproved context:\n${context}`,
            workspace.files,
            current.approvedPaths,
            current.approvedCreatePaths,
            current.approvedDeletePaths,
          ),
          coder = generated.coder,
          proposal = generated.proposal,
          reviewed = await generateValidatedReview(
            modelRouter,
            body,
            `Review this revised patch against the exact user intent and approved source. Approve a minimal behavior-preserving edit when it satisfies the request. Return JSON only as {"approved":boolean,"summary":string,"findings":[string]}.\nIntent: ${current.intent}\nApproved source:\n${context}\nRevised proposal: ${stable(proposal)}`,
          ),
          review = reviewed.review;
        persist({
          ...current,
          status: "diff_review",
          proposal,
          review,
          provider: coder.provider,
          model: coder.model,
        });
        append(owner, id, "coder.revised", {
          ...modelEvidence(coder),
          validationAttempts: generated.attempts,
          files: proposal.files.map((file) => ({
            path: file.path,
            operation: file.operation,
            digest: sha(file.content),
          })),
        });
        append(owner, id, "reviewer.revision_completed", {
          ...modelEvidence(reviewed.reviewer),
          ...review,
          validationAttempts: reviewed.attempts,
        });
      } else if (body.action === "apply") {
        requireState(current, "diff_review");
        if (!current.review?.approved)
          throw fault(
            "Reviewer did not approve this proposal.",
            "review_not_approved",
            409,
          );
        if (workspace.revision !== current.workspaceRevision)
          throw fault(
            "Workspace changed after agent context capture.",
            "revision_conflict",
            409,
          );
        authorize(
          "workspace-write",
          "write-once",
          "One-time write approval is required.",
          "write_approval_required",
        );
        const files = { ...workspace.files };
        for (const file of current.proposal.files) {
          if (file.operation === "delete") delete files[file.path];
          else files[file.path] = file.content;
        }
        const deleted = current.proposal.files
          .filter((file) => file.operation === "delete")
          .map((file) => ({
            path: file.path,
            content: file.content,
            digest: sha(file.content),
          }));
        const folders = [
            ...new Set([
              ...workspace.folders,
              ...current.proposal.files.flatMap((file) => parents(file.path)),
            ]),
          ].sort(),
          applyAttempt =
            current.events.filter(
              (event) => event.event_type === "write.applied",
            ).length + 1,
          saved = workspaceStore.put(owner, current.projectId, {
            expectedRevision: workspace.revision,
            idempotencyKey: `agent-${id}-${applyAttempt}`,
            payload: {
              name: workspace.name,
              files,
              folders,
              open: workspace.open.filter((path) => Object.hasOwn(files, path)),
              active: Object.hasOwn(files, workspace.active)
                ? workspace.active
                : Object.keys(files).sort()[0],
            },
          });
        const trash = [
          ...(current.trash || []),
          ...deleted.map((file) => ({
            ...file,
            deletedRevision: saved.revision,
          })),
        ];
        persist({
          ...current,
          status: "applied",
          trash,
          workspaceRevision: saved.revision,
        });
        append(owner, id, "write.applied", {
          approval: "write-once",
          attempt: applyAttempt,
          revision: saved.revision,
          files: current.proposal.files.map((file) => ({
            path: file.path,
            operation: file.operation,
          })),
        });
      } else if (body.action === "restore-deleted") {
        requireStateOneOf(current, [
          "applied",
          "test_failed",
          "tested",
          "deployment_review",
          "deployment_approved",
        ]);
        const latest = workspaceStore.get(owner, current.projectId),
          requested = [...new Set((body.paths || []).map(safePath))],
          available = new Map(
            (current.trash || []).map((file) => [file.path, file]),
          );
        if (!requested.length || requested.some((path) => !available.has(path)))
          throw fault(
            "Restore paths must select recoverable deleted files.",
            "invalid_restore_paths",
            400,
          );
        if (latest.revision !== current.workspaceRevision)
          throw fault(
            "Workspace changed after the agent deletion.",
            "revision_conflict",
            409,
          );
        if (requested.some((path) => Object.hasOwn(latest.files, path)))
          throw fault(
            "A restore path now exists in the workspace.",
            "restore_path_conflict",
            409,
          );
        authorize(
          "workspace-restore",
          "restore-once",
          "One-time restore approval is required.",
          "restore_approval_required",
        );
        const files = { ...latest.files };
        for (const path of requested) files[path] = available.get(path).content;
        const restoreAttempt =
            current.events.filter(
              (event) => event.event_type === "trash.restored",
            ).length + 1,
          saved = workspaceStore.put(owner, current.projectId, {
            expectedRevision: latest.revision,
            idempotencyKey: `agent-${id}-restore-${restoreAttempt}`,
            payload: {
              name: latest.name,
              files,
              folders: [
                ...new Set([
                  ...latest.folders,
                  ...requested.flatMap(parents),
                ]),
              ].sort(),
              open: latest.open,
              active: latest.active,
            },
          }),
          trash = (current.trash || []).filter(
            (file) => !requested.includes(file.path),
          );
        persist({
          ...current,
          status: "restored",
          deployment: null,
          gitOperation: null,
          trash,
          workspaceRevision: saved.revision,
        });
        append(owner, id, "trash.restored", {
          approval: "restore-once",
          revision: saved.revision,
          files: requested.map((path) => ({
            path,
            digest: available.get(path).digest,
          })),
        });
      } else if (body.action === "run-test") {
        requireState(current, "applied");
        if (!workspaceRuntime)
          throw fault(
            "Workspace runtime is unavailable.",
            "runtime_unavailable",
            503,
          );
        const activePath = safePath(body.activePath),
          latest = workspaceStore.get(owner, current.projectId);
        if (!Object.hasOwn(latest.files, activePath))
          throw fault(
            "Test entry file was not found.",
            "test_entry_not_found",
            400,
          );
        authorize(
          "test-build-execute",
          "execute-once",
          "One-time execute approval is required.",
          "execute_approval_required",
        );
        const result = await workspaceRuntime.runTaskForOwner(owner, {
          protocolVersion: "ynx-code/v1",
          task: "build-run-active",
          projectId: current.projectId,
          activePath,
          files: latest.files,
          approval: "execute-once",
        });
        persist({
          ...current,
          status: result.ok ? "tested" : "test_failed",
          workspaceRevision: latest.revision,
        });
        append(owner, id, "tester.completed", {
          approval: "execute-once",
          activePath,
          result,
        });
      } else if (body.action === "generate-fix") {
        requireState(current, "test_failed");
        const latest = workspaceStore.get(owner, current.projectId),
          failure = current.events.findLast(
            (event) => event.event_type === "tester.completed",
          )?.payload.result;
        if (!failure || failure.ok)
          throw fault(
            "No failed Tester evidence is available.",
            "test_evidence_missing",
            409,
          );
        authorize(
          "model-network",
          "model-request-once",
          "One-time model request approval is required.",
          "model_request_approval_required",
        );
        const fixPaths = current.approvedPaths.filter((path) =>
            Object.hasOwn(latest.files, path),
          ),
          context = fixPaths
            .map(
              (path) =>
                `--- ${path} sha256=${sha(latest.files[path])} ---\n${latest.files[path]}`,
            )
            .join("\n"),
          generated = await generateValidatedProposal(
            modelRouter,
            body,
            `Fix the exact Tester failure. Return JSON only as {\"summary\":string,\"edits\":[{\"path\":string,\"expectedDigest\":string,\"replacements\":[{\"find\":string,\"replace\":string}]}]}. Use exact non-empty find text that occurs once and ensure the materialized file changes.\nTester evidence:\n${failure.output}\nApproved current context:\n${context}`,
            latest.files,
            fixPaths,
            [],
            [],
          ),
          coder = generated.coder,
          proposal = generated.proposal,
          reviewed = await generateValidatedReview(
            modelRouter,
            body,
            `Review whether this fix addresses the exact Tester evidence without unrelated changes. Return JSON only as {\"approved\":boolean,\"summary\":string,\"findings\":[string]}.\nFailure: ${failure.output}\nFix: ${stable(proposal)}`,
          ),
          review = reviewed.review;
        persist({
          ...current,
          status: "diff_review",
          proposal,
          review,
          workspaceRevision: latest.revision,
        });
        append(owner, id, "coder.fix_proposed", {
          ...modelEvidence(coder),
          validationAttempts: generated.attempts,
          failureTaskId: failure.taskId,
          files: proposal.files.map((file) => ({
            path: file.path,
            operation: file.operation,
            digest: sha(file.content),
          })),
        });
        append(owner, id, "reviewer.fix_completed", {
          ...modelEvidence(reviewed.reviewer),
          ...review,
          validationAttempts: reviewed.attempts,
        });
      } else if (body.action === "prepare-git") {
        requireState(current, "tested");
        if (!gitService?.runForOwner)
          throw fault(
            "The reviewed local Git adapter is unavailable.",
            "git_adapter_unavailable",
            503,
          );
        const latest = workspaceStore.get(owner, current.projectId),
          testEvent = current.events.findLast(
            (event) => event.event_type === "tester.completed",
          );
        if (
          !testEvent?.payload?.result?.ok ||
          latest.revision !== current.workspaceRevision
        )
          throw fault(
            "Passing Tester evidence for the current workspace revision is required.",
            "git_test_evidence_required",
            409,
          );
        const status = await gitService.runForOwner(owner, current.projectId),
          message = body.message
            ? text(body.message, 1, 4096, "commit message")
            : `Agent: ${current.intent.slice(0, 72)}`,
          files = gitReviewFiles(status, latest, current.trash);
        if (!files.length)
          throw fault(
            "The current workspace has no local Git changes to commit.",
            "git_no_changes",
            409,
          );
        const intent = {
            projectId: current.projectId,
            workspaceRevision: latest.revision,
            initialized: status.initialized,
            branch: status.branch,
            head: status.head || null,
            message,
            files,
            testEvidenceHash: testEvent.event_hash,
          },
          gitOperation = {
            ...intent,
            previewDigest: sha(stable(intent)),
            preparedAt: new Date().toISOString(),
            executable: false,
            boundary: "local-only-no-network-no-credentials-no-hooks-no-signing",
          };
        persist({ ...current, status: "git_review", gitOperation });
        append(owner, id, "git.previewed", gitOperation);
      } else if (body.action === "approve-git") {
        requireState(current, "git_review");
        if (!gitService?.runForOwner || !current.gitOperation)
          throw fault(
            "The reviewed local Git adapter is unavailable.",
            "git_adapter_unavailable",
            503,
          );
        const latest = workspaceStore.get(owner, current.projectId),
          preview = current.gitOperation,
          status = await gitService.runForOwner(owner, current.projectId);
        if (
          latest.revision !== preview.workspaceRevision ||
          status.initialized !== preview.initialized ||
          (status.branch || null) !== (preview.branch || null) ||
          (status.head || null) !== (preview.head || null) ||
          stable(gitReviewFiles(status, latest, current.trash)) !==
            stable(preview.files)
        )
          throw fault(
            "The workspace or local repository changed after Git review.",
            "git_preview_stale",
            409,
          );
        authorize(
          "git-local-commit",
          "git-local-commit-once",
          "One-time local Git commit approval is required.",
          "git_commit_approval_required",
        );
        try {
          const committed = await gitService.runForOwner(
            owner,
            current.projectId,
            {
              protocolVersion: "ynx-code-git-v1",
              action: "commit-reviewed",
              expectedRevision: preview.workspaceRevision,
              expectedInitialized: preview.initialized,
              expectedHead: preview.head,
              expectedBranch: preview.branch,
              paths: preview.files.map((file) => file.path),
              message: preview.message,
              authorName: "YNX Code Agent",
              authorEmail: "agent@ynx.local",
            },
          );
          const gitOperation = {
            ...preview,
            approval: "git-local-commit-once",
            committedAt: new Date().toISOString(),
            commit: committed.head,
            branch: committed.branch,
            executable: false,
            executed: true,
          };
          persist({ ...current, status: "git_committed", gitOperation });
          append(owner, id, "git.committed", {
            approval: "git-local-commit-once",
            previewDigest: preview.previewDigest,
            workspaceRevision: latest.revision,
            commit: committed.head,
            branch: committed.branch,
            files: preview.files,
            boundary: preview.boundary,
          });
        } catch (error) {
          append(owner, id, "git.commit_failed", {
            previewDigest: preview.previewDigest,
            code: error.code || "git_operation_failed",
          });
          throw error;
        }
      } else if (body.action === "prepare-deployment") {
        requireStateOneOf(current, ["tested", "git_committed"]);
        const latest = workspaceStore.get(owner, current.projectId),
          testEvent = current.events.findLast(
            (event) => event.event_type === "tester.completed",
          );
        if (
          !testEvent?.payload?.result?.ok ||
          latest.revision !== current.workspaceRevision
        )
          throw fault(
            "Passing Tester evidence for the current workspace revision is required.",
            "deployment_test_evidence_required",
            409,
          );
        const target = body.target || "ynx-testnet";
        if (!["ynx-testnet", "web-preview"].includes(target))
          throw fault(
            "Deployment preview target is not supported.",
            "invalid_deployment_target",
            400,
          );
        const deployment = {
          target,
          workspaceRevision: latest.revision,
          files: Object.entries(latest.files)
            .map(([path, content]) => ({
              path,
              digest: sha(content),
              bytes: Buffer.byteLength(content),
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
          testEvidenceHash: testEvent.event_hash,
          preparedAt: new Date().toISOString(),
          executable: false,
          requires: [
            "deployment-execute-once",
            "wallet review",
            "canonical chain identity",
            "receipt verification",
          ],
          boundary: "review-only-no-network-no-signing",
        };
        persist({ ...current, status: "deployment_review", deployment });
        append(owner, id, "deployment.previewed", deployment);
      } else if (body.action === "approve-deployment") {
        requireState(current, "deployment_review");
        authorize(
          "deployment-review",
          "deployment-review-once",
          "One-time deployment review approval is required.",
          "deployment_review_approval_required",
        );
        const deployment = {
          ...current.deployment,
          approval: "deployment-review-once",
          approvedAt: new Date().toISOString(),
          executable: false,
        };
        persist({ ...current, status: "deployment_approved", deployment });
        append(owner, id, "deployment.review_approved", deployment);
      } else throw fault("Unknown agent action.", "invalid_agent_action", 400);
      json(response, 200, { protocolVersion: PROTOCOL, run: read(owner, id) });
      return true;
      function persist(value) {
        const now = new Date().toISOString();
        updateRun.run(
          value.status,
          value.provider,
          value.model,
          nullable(value.plan),
          stable(value.approvedPaths || []),
          stable(value.approvedCreatePaths || []),
          stable(value.approvedDeletePaths || []),
          nullable(value.proposal),
          nullable(value.review),
          nullable(value.deployment),
          nullable(value.gitOperation),
          stable(value.trash || []),
          value.workspaceRevision,
          now,
          owner,
          id,
        );
      }
      function authorize(permission, expected, message, code) {
        const granted = body.approval === expected;
        if (granted) {
          try {
            claimApproval(
              owner,
              body.approvalId,
              permission,
              id,
              getApproval,
              insertApproval,
            );
          } catch (error) {
            append(owner, id, "permission.decision", {
              permission,
              decision: "denied",
              approval: expected,
              approvalId: body.approvalId || null,
              requestAction: body.action,
              reason: error.code,
            });
            throw error;
          }
        }
        append(owner, id, "permission.decision", {
          permission,
          decision: granted ? "granted" : "denied",
          approval: granted ? expected : null,
          approvalId: granted ? body.approvalId : null,
          requestAction: body.action,
        });
        if (!granted) throw fault(message, code, 403);
      }
    } catch (error) {
      if (response.destroyed || response.writableEnded) return true;
      json(response, error.status || 400, {
        error: error.message || "Agent operation failed.",
        code: error.code || "agent_operation_failed",
      });
      return true;
    }
  }
  return { handler, read, close: () => db.close() };
}
function modelInput(body, role, prompt, signal) {
  const limits = { Planner: 384, Coder: 1024, Reviewer: 512 };
  return {
    provider: body.provider || "ynx-hosted",
    model: body.model,
    apiKey: body.apiKey,
    system: `You are the YNX Code ${role} Agent. Never claim tools ran without supplied evidence. Follow the JSON schema exactly.`,
    prompt,
    outputLanguage: body.outputLanguage || "en",
    maxOutputTokens: limits[role] || 1024,
    responseFormat: "json",
    signal: signal || body.requestSignal,
  };
}
function record(row, eventRows) {
  const parsedEvents = eventRows.map((event) => ({
    ...event,
    payload: JSON.parse(event.payload),
  })),
    trash = JSON.parse(row.trash || "[]");
  return {
    runId: row.run_id,
    projectId: row.project_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    intent: row.intent,
    workspaceRevision: Number(row.workspace_revision),
    plan: parseNullable(row.plan),
    approvedPaths: JSON.parse(row.approved_paths || "[]"),
    approvedCreatePaths: JSON.parse(row.approved_create_paths || "[]"),
    approvedDeletePaths: JSON.parse(row.approved_delete_paths || "[]"),
    proposal: parseNullable(row.proposal),
    review: parseNullable(row.review),
    deployment: parseNullable(row.deployment),
    gitOperation: parseNullable(row.git_operation),
    trash,
    usage: summarizeUsage(parsedEvents),
    permissions: permissionMatrix(parsedEvents, row.status, trash),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: parsedEvents,
  };
}
function permissionMatrix(events, status, trash) {
  const decisions = events.filter(
      (event) => event.event_type === "permission.decision",
    ),
    count = (permission, decision = "granted") =>
      decisions.filter(
        (event) =>
          event.payload?.permission === permission &&
          event.payload?.decision === decision,
      ).length,
    contextApproved = events.some(
      (event) => event.event_type === "context.approved",
    ),
    modelCalls = events.filter((event) =>
      /^(planner|coder|reviewer)\./.test(event.event_type),
    ).length,
    deleteUses = events.filter(
      (event) =>
        event.event_type === "write.applied" &&
        event.payload?.files?.some((file) => file.operation === "delete"),
    ).length,
    matrix = [
      {
        id: "read-context",
        level: "read",
        status: contextApproved ? "used" : "available",
        approval: "context-read-once",
        uses: count("read-context"),
      },
      {
        id: "model-network",
        level: "network",
        status: modelCalls ? "used" : "available",
        approval: "model-request-once",
        uses: modelCalls,
      },
      {
        id: "workspace-write",
        level: "write",
        status: count("workspace-write") ? "used" : "available",
        approval: "write-once",
        uses: count("workspace-write"),
      },
      {
        id: "recoverable-delete",
        level: "write",
        status: deleteUses ? "used" : "available",
        approval: "write-once",
        uses: deleteUses,
      },
      {
        id: "workspace-restore",
        level: "write",
        status: trash.length
          ? "available"
          : count("workspace-restore")
            ? "used"
            : "locked",
        approval: "restore-once",
        uses: count("workspace-restore"),
      },
      {
        id: "test-build-execute",
        level: "execute",
        status: count("test-build-execute") ? "used" : "available",
        approval: "execute-once",
        uses: count("test-build-execute"),
      },
      {
        id: "deployment-review",
        level: "deploy-review",
        status:
          status === "deployment_approved"
            ? "used"
            : status === "deployment_review"
              ? "available"
              : "locked",
        approval: "deployment-review-once",
        uses: count("deployment-review"),
      },
      {
        id: "git-local-commit",
        level: "git",
        status:
          status === "git_committed"
            ? "used"
            : status === "git_review"
              ? "available"
              : "locked",
        approval: "git-local-commit-once",
        uses: count("git-local-commit"),
        boundary: "local-only; no network, credentials, hooks, signing or remote",
      },
    ];
  for (const [id, level, boundary] of [
    ["package-install", "package", "reviewed adapter not connected"],
    ["git-remote", "git", "pull, push and PR execution disabled"],
    ["browser-network", "network", "agent browser authority disabled"],
    ["secret-reference", "secret", "secret material is ineligible"],
    ["destructive-delete", "destructive", "irrecoverable delete disabled"],
    ["deployment-execute", "deploy", "Wallet-reviewed flow required"],
  ])
    matrix.push({
      id,
      level,
      status: "disabled",
      approval: null,
      uses: 0,
      boundary,
    });
  return matrix;
}
function claimApproval(
  owner,
  approvalId,
  permission,
  runId,
  getApproval,
  insertApproval,
) {
  if (
    typeof approvalId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      approvalId,
    )
  )
    throw fault(
      "A unique approval identifier is required.",
      "approval_id_required",
      403,
    );
  if (getApproval.get(owner, approvalId))
    throw fault(
      "This one-time approval was already consumed.",
      "approval_replayed",
      409,
    );
  insertApproval.run(
    owner,
    approvalId,
    permission,
    runId,
    new Date().toISOString(),
  );
}
function modelEvidence(result) {
  const inputTokens = Number.isFinite(result?.usage?.inputTokens)
      ? result.usage.inputTokens
      : null,
    outputTokens = Number.isFinite(result?.usage?.outputTokens)
      ? result.usage.outputTokens
      : null;
  return {
    provider: result?.provider || "unknown",
    model: result?.model || "unknown",
    usage: { inputTokens, outputTokens },
    durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : null,
    cost: {
      amount: null,
      currency: null,
      status: "unreported-by-provider",
    },
  };
}
function summarizeUsage(events) {
  const calls = events.filter((event) =>
    /^(planner|coder|reviewer)\./.test(event.event_type),
  );
  let inputTokens = 0,
    outputTokens = 0,
    durationMs = 0,
    reportedCalls = 0,
    unreportedCalls = 0;
  for (const call of calls) {
    const usage = call.payload?.usage,
      reported =
        Number.isFinite(usage?.inputTokens) &&
        Number.isFinite(usage?.outputTokens);
    if (reported) {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      reportedCalls++;
    } else unreportedCalls++;
    if (Number.isFinite(call.payload?.durationMs))
      durationMs += call.payload.durationMs;
  }
  return {
    inputTokens,
    outputTokens,
    durationMs,
    reportedCalls,
    unreportedCalls,
    cost: {
      amount: null,
      currency: null,
      status: "unreported-by-provider",
    },
  };
}
function validatePlan(value, files) {
  if (
    !value ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > 24
  )
    throw fault("Planner returned an invalid plan.", "invalid_agent_plan", 502);
  return {
    summary: text(value.summary, 1, 2000, "summary"),
    steps: value.steps.map((step) => ({
      title: text(step?.title, 1, 200, "step title"),
      acceptance: text(step?.acceptance, 1, 1000, "acceptance"),
    })),
    contextPaths: validatePaths(value.contextPaths || [], files),
    createPaths: validateCreatePaths(value.createPaths || [], files),
    deletePaths: validatePaths(value.deletePaths || [], files),
  };
}
function materializeProposal(
  value,
  files,
  approvedPaths,
  approvedCreatePaths,
  approvedDeletePaths,
) {
  const edits = value?.edits || [],
    creates = value?.creates || [],
    deletes = value?.deletes || [];
  if (
    !value ||
    typeof value.summary !== "string" ||
    !Array.isArray(edits) ||
    !Array.isArray(creates) ||
    !Array.isArray(deletes) ||
    edits.length > 64 ||
    creates.length > 32 ||
    deletes.length > 32 ||
    edits.length + creates.length + deletes.length < 1
  )
    throw fault(
      "Coder returned an invalid edit proposal.",
      "invalid_agent_proposal",
      502,
    );
  const approved = new Set(approvedPaths),
    approvedCreates = new Set(approvedCreatePaths),
    approvedDeletes = new Set(approvedDeletePaths),
    paths = new Set(),
    output = [];
  let bytes = 0;
  for (const edit of edits) {
    const path = safePath(modelPath(edit?.path, approvedPaths));
    if (
      paths.has(path) ||
      !approved.has(path) ||
      typeof files[path] !== "string"
    )
      throw fault(
        "Edit path was not approved or is duplicated.",
        "invalid_agent_proposal",
        502,
      );
    paths.add(path);
    if (edit.expectedDigest !== sha(files[path]))
      throw fault(
        "Edit digest does not match approved context.",
        "proposal_digest_mismatch",
        409,
      );
    if (
      !Array.isArray(edit.replacements) ||
      edit.replacements.length < 1 ||
      edit.replacements.length > 64
    )
      throw fault(
        "Edit replacements are invalid.",
        "invalid_agent_proposal",
        502,
      );
    let content = files[path];
    for (const replacement of edit.replacements) {
      const find =
          typeof replacement?.find === "string" ? replacement.find : "",
        replace =
          typeof replacement?.replace === "string" ? replacement.replace : "";
      if (!find || find.length > 256 * 1024 || replace.length > 512 * 1024)
        throw fault(
          "Replacement exceeds its boundary.",
          "invalid_agent_proposal",
          502,
        );
      const first = content.indexOf(find);
      if (first < 0 || content.indexOf(find, first + find.length) >= 0)
        throw fault(
          "Replacement source must match exactly once.",
          "proposal_match_conflict",
          409,
        );
      content = `${content.slice(0, first)}${replace}${content.slice(first + find.length)}`;
    }
    if (sha(content) === sha(files[path]))
      throw fault(
        "Proposal did not change the approved file.",
        "proposal_noop",
        409,
      );
    bytes += Buffer.byteLength(content);
    if (bytes > 2 * 1024 * 1024)
      throw fault(
        "Proposal exceeds workspace boundary.",
        "invalid_agent_proposal",
        502,
      );
    output.push({ path, content, operation: "edit" });
  }
  for (const create of creates) {
    const path = safePath(modelPath(create?.path, approvedCreatePaths)),
      content = typeof create?.content === "string" ? create.content : "";
    if (
      paths.has(path) ||
      !approvedCreates.has(path) ||
      Object.hasOwn(files, path)
    )
      throw fault(
        "Create path was not approved, is duplicated, or already exists.",
        "invalid_agent_proposal",
        502,
      );
    if (!content || Buffer.byteLength(content) > 512 * 1024)
      throw fault(
        "Created file content exceeds its boundary.",
        "invalid_agent_proposal",
        502,
      );
    paths.add(path);
    bytes += Buffer.byteLength(content);
    if (bytes > 2 * 1024 * 1024)
      throw fault(
        "Proposal exceeds workspace boundary.",
        "invalid_agent_proposal",
        502,
      );
    output.push({ path, content, operation: "create" });
  }
  for (const deletion of deletes) {
    const path = safePath(modelPath(deletion?.path, approvedDeletePaths));
    if (
      paths.has(path) ||
      !approvedDeletes.has(path) ||
      typeof files[path] !== "string"
    )
      throw fault(
        "Delete path was not approved, is duplicated, or does not exist.",
        "invalid_agent_proposal",
        502,
      );
    if (deletion.expectedDigest !== sha(files[path]))
      throw fault(
        "Delete digest does not match approved context.",
        "proposal_digest_mismatch",
        409,
      );
    paths.add(path);
    output.push({ path, content: files[path], operation: "delete" });
  }
  if (Object.keys(files).length + creates.length - deletes.length < 1)
    throw fault(
      "A proposal cannot delete the final workspace file.",
      "final_workspace_file_required",
      409,
    );
  return { summary: text(value.summary, 1, 2000, "summary"), files: output };
}
function modelPath(value, approvedPaths = []) {
  if (typeof value !== "string") return value;
  let path = value.trim().replaceAll("`", "");
  if (
    ((path.startsWith('"') && path.endsWith('"')) ||
      (path.startsWith("'") && path.endsWith("'")) ||
      (path.startsWith("<") && path.endsWith(">"))) &&
    path.length > 2
  )
    path = path.slice(1, -1).trim();
  if (path.startsWith("./")) path = path.slice(2);
  if (approvedPaths.includes(path)) return path;
  const matches = approvedPaths.filter((approved) => path.includes(approved));
  return matches.length === 1 ? matches[0] : path;
}
async function generateValidatedProposal(
  modelRouter,
  body,
  prompt,
  files,
  approvedPaths,
  approvedCreatePaths,
  approvedDeletePaths,
) {
  let lastError;
  const boundedPrompt = `${prompt}\nAllowed edit path values: ${JSON.stringify(approvedPaths)}. Allowed create path values: ${JSON.stringify(approvedCreatePaths)}. Allowed delete path values: ${JSON.stringify(approvedDeletePaths)}. Every path field must equal one of the corresponding strings exactly.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const coder = await modelRouter.generate(
      modelInput(
        body,
        "Coder",
        attempt === 1
          ? boundedPrompt
          : `${boundedPrompt}\nYour previous proposal failed server validation: ${lastError.message}. Correct that exact issue and return JSON only.`,
      ),
    );
    try {
      return {
        coder,
        proposal: materializeProposal(
          parseJson(coder.text),
          files,
          approvedPaths,
          approvedCreatePaths,
          approvedDeletePaths,
        ),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
async function generateValidatedReview(modelRouter, body, prompt) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reviewer = await modelRouter.generate(
      modelInput(
        body,
        "Reviewer",
        attempt === 1
          ? prompt
          : `${prompt}\nYour previous review failed server validation: ${lastError.message}. Correct the schema and return JSON only.`,
      ),
    );
    try {
      return {
        reviewer,
        review: validateReview(parseJson(reviewer.text)),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
function validateReview(value) {
  if (
    !value ||
    typeof value.approved !== "boolean" ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.findings)
  )
    throw fault(
      "Reviewer returned an invalid result.",
      "invalid_agent_review",
      502,
    );
  return {
    approved: value.approved,
    summary: text(value.summary, 1, 2000, "review summary"),
    findings: value.findings.slice(0, 50).map(normalizeFinding),
  };
}
function normalizeFinding(value) {
  if (typeof value === "string") return text(value, 1, 1000, "finding");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fault(
      "Reviewer returned an invalid finding.",
      "invalid_agent_review",
      502,
    );
  const message =
    typeof value.message === "string"
      ? value.message
      : typeof value.description === "string"
        ? value.description
        : typeof value.title === "string"
          ? value.title
          : null;
  if (!message)
    throw fault(
      "Reviewer returned an invalid finding.",
      "invalid_agent_review",
      502,
    );
  const severity =
    typeof value.severity === "string" &&
    /^(info|low|medium|high|critical)$/i.test(value.severity.trim())
      ? `${value.severity.trim().toLowerCase()}: `
      : "";
  return text(`${severity}${message}`, 1, 1000, "finding");
}
function validatePaths(value, files) {
  if (!Array.isArray(value) || value.length > 64)
    throw fault(
      "Invalid context path selection.",
      "invalid_context_paths",
      400,
    );
  return [...new Set(value.map((path) => safePath(path)))].filter((path) =>
    Object.hasOwn(files, path),
  );
}
function validateCreatePaths(value, files) {
  if (!Array.isArray(value) || value.length > 32)
    throw fault(
      "Invalid create path selection.",
      "invalid_create_paths",
      400,
    );
  const paths = [...new Set(value.map((path) => safePath(path)))].sort();
  for (const path of paths)
    if (
      Object.hasOwn(files, path) ||
      parents(path).some((parent) => Object.hasOwn(files, parent)) ||
      paths.some(
        (other) => other !== path && other.startsWith(`${path}/`),
      )
    )
      throw fault(
        "Create path collides with the current workspace.",
        "create_path_conflict",
        409,
      );
  return paths;
}
function gitReviewFiles(status, workspace, trash = []) {
  if (!status || typeof status.initialized !== "boolean")
    throw fault("Local Git returned an invalid status.", "git_status_invalid", 502);
  if (!status.initialized)
    return Object.entries(workspace.files)
      .map(([path, content]) => ({
        path: safePath(path),
        operation: "add",
        gitStatus: "??",
        digest: sha(content),
        bytes: Buffer.byteLength(content),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  const deleted = new Map(trash.map((file) => [file.path, file]));
  return (status.changes || [])
    .map((change) => {
      const path = safePath(change.path),
        content = workspace.files[path],
        prior = deleted.get(path),
        operation =
          content === undefined
            ? "delete"
            : change.status === "??" || change.indexStatus === "A"
              ? "add"
              : "update";
      if (content === undefined && !prior)
        throw fault(
          "Deleted Git content is not available in recoverable Agent trash.",
          "git_deleted_content_unavailable",
          409,
        );
      const reviewed = content === undefined ? prior.content : content;
      return {
        path,
        operation,
        gitStatus: String(change.status || "").slice(0, 2),
        digest: sha(reviewed),
        bytes: Buffer.byteLength(reviewed),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9_./ +@-]+$/.test(value)
  )
    throw fault("Unsafe workspace path.", "unsafe_workspace_path", 400);
  return value;
}
function parents(path) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
function requireState(run, state) {
  if (run.status !== state)
    throw fault(`Agent run must be in ${state}.`, "invalid_agent_state", 409);
}
function requireStateOneOf(run, states) {
  if (!states.includes(run.status))
    throw fault(
      `Agent run must be in one of: ${states.join(", ")}.`,
      "invalid_agent_state",
      409,
    );
}
function validId(value, label) {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_]{1,160}$/.test(value))
    throw fault(`Invalid ${label} identifier.`, `invalid_${label}`, 400);
  return value;
}
function text(value, min, max, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min || result.length > max)
    throw fault(
      `Invalid ${label}.`,
      `invalid_${label.replaceAll(" ", "_")}`,
      400,
    );
  return result;
}
function parseJson(value) {
  const source = String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(source);
  } catch {}
  let start = -1,
    depth = 0,
    string = false,
    escape = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (string) {
      if (escape) escape = false;
      else if (character === "\\") escape = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') {
      string = true;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, index + 1));
      } catch {
        break;
      }
    }
  }
  throw fault("Model returned malformed JSON.", "malformed_model_output", 502);
}
function parseNullable(value) {
  return value ? JSON.parse(value) : null;
}
function nullable(value) {
  return value == null ? null : stable(value);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw fault("Request too large.", "request_too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
export const AGENT_PROTOCOL = PROTOCOL;
