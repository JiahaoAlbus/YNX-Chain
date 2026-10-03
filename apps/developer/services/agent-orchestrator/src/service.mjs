import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existingHostedRequest, validatedModelAttachments } from "../../model-router/src/hosted-request.mjs";
import { consumerIdentityBinding, assertExpectedIdentity } from "../../codeoss-service/src/identity-consumer-binding.mjs";
import { inspectAgentGitRecovery } from "./git-recovery.mjs";

const PROTOCOL = "ynx-code-agent/v1",
  MAX_BODY = 640 * 1024;
export function createAgentOrchestrator({
  filename,
  ownerForRequest,
  verifyIdentity,
  aiStore,
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
  db.exec("CREATE TABLE IF NOT EXISTS agent_operations(owner_id TEXT NOT NULL,run_id TEXT NOT NULL,operation_id TEXT NOT NULL,instance_id TEXT NOT NULL,owner_pid INTEGER NOT NULL,status TEXT NOT NULL,action TEXT NOT NULL,started_at TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT,PRIMARY KEY(owner_id,run_id)); CREATE INDEX IF NOT EXISTS agent_operation_status ON agent_operations(status);");
  for (const column of ["write_intent", "recovery_evidence"])
    if (!db.prepare("PRAGMA table_info(agent_operations)").all().some(item => item.name === column))
      db.exec(`ALTER TABLE agent_operations ADD COLUMN ${column} TEXT`);
  const instanceId = randomUUID();
  let closed = false, databaseClosed = false, closePromise, resolveClose;
  const controllers = new Set();
  function closeWhenDrained() {
    if (!closed || databaseClosed || controllers.size) return;
    db.prepare("UPDATE agent_operations SET status='interrupted',updated_at=?,error_code='agent_service_closed' WHERE instance_id=? AND status='running'").run(new Date().toISOString(), instanceId);
    databaseClosed = true; db.close(); resolveClose?.();
  }
  const readOperation = db.prepare("SELECT * FROM agent_operations WHERE owner_id=? AND run_id=?"),
    claimOperation = db.prepare("INSERT INTO agent_operations(owner_id,run_id,operation_id,instance_id,owner_pid,status,action,started_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?) ON CONFLICT(owner_id,run_id) DO UPDATE SET operation_id=excluded.operation_id,instance_id=excluded.instance_id,owner_pid=excluded.owner_pid,status='running',action=excluded.action,started_at=excluded.started_at,updated_at=excluded.updated_at,error_code=NULL,write_intent=NULL,recovery_evidence=NULL WHERE agent_operations.status<>'running'"),
    finishOperation = db.prepare("UPDATE agent_operations SET status=?,updated_at=?,error_code=? WHERE owner_id=? AND run_id=? AND operation_id=? AND status='running'");
  function recoverOperations() {
    for (const operation of db.prepare("SELECT * FROM agent_operations WHERE status='running'").all()) {
      if (processAlive(Number(operation.owner_pid))) continue;
      finishOperation.run("interrupted", new Date().toISOString(), "agent_process_interrupted", operation.owner_id, operation.run_id, operation.operation_id);
    }
    for (const operation of db.prepare("SELECT * FROM agent_operations WHERE status='interrupted' AND write_intent IS NOT NULL").all()) {
      const intent = JSON.parse(operation.write_intent), row = getRun.get(operation.owner_id, operation.run_id);
      if (!row || !workspaceStore.mutationReceipt) continue;
      const receipt = workspaceStore.mutationReceipt(operation.owner_id, row.project_id, intent.idempotencyKey);
      if (!receipt) continue;
      if (receipt.requestHash !== intent.requestHash || receipt.revision !== intent.expectedRevision + 1) {
        db.prepare("UPDATE agent_operations SET error_code='agent_write_recovery_mismatch' WHERE owner_id=? AND run_id=? AND operation_id=? AND status='interrupted'")
          .run(operation.owner_id, operation.run_id, operation.operation_id);
        continue;
      }
      atomic(() => {
        // Recheck after obtaining the SQLite write lock: another reader may have recovered it.
        if (readOperation.get(operation.owner_id, operation.run_id)?.write_intent !== operation.write_intent) return;
        const value = record(getRun.get(operation.owner_id, operation.run_id), []);
        saveRun(operation.owner_id, operation.run_id, { ...value, status: intent.targetStatus,
          workspaceRevision: receipt.revision, trash: intent.trash,
          ...(intent.clearReviews ? { deployment: null, gitOperation: null } : {}) });
        appendEvent(operation.owner_id, operation.run_id, intent.event.type, { ...intent.event.payload, revision: receipt.revision });
        db.prepare("UPDATE agent_operations SET status='finished',updated_at=?,error_code=NULL,write_intent=NULL WHERE owner_id=? AND run_id=? AND operation_id=?")
          .run(new Date().toISOString(), operation.owner_id, operation.run_id, operation.operation_id);
      });
    }
  }
  const getRun = db.prepare(
      "SELECT * FROM agent_runs WHERE owner_id=? AND run_id=?",
    ),
    listRuns = db.prepare(
      "SELECT * FROM agent_runs WHERE owner_id=? AND project_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND run_id<?)) ORDER BY created_at DESC,run_id DESC LIMIT ?",
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
  const appendEvent = (owner, runId, type, payload) => {
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
  function atomic(action) {
    const owned = !db.isTransaction;
    if (owned) db.exec("BEGIN IMMEDIATE");
    try { const value = action(); if (owned) db.exec("COMMIT"); return value; }
    catch (error) { if (owned) db.exec("ROLLBACK"); throw error; }
  }
  function saveRun(owner, runId, value) {
    updateRun.run(value.status, value.provider, value.model, nullable(value.plan),
      stable(value.approvedPaths || []), stable(value.approvedCreatePaths || []), stable(value.approvedDeletePaths || []),
      nullable(value.proposal), nullable(value.review), nullable(value.deployment), nullable(value.gitOperation),
      stable(value.trash || []), value.workspaceRevision, new Date().toISOString(), owner, runId);
  }
  recoverOperations();
  const read = (owner, runId) => {
    recoverOperations();
    const row = getRun.get(owner, runId);
    return row ? { ...record(row, events.all(owner, runId)), operation: operationValue(readOperation.get(owner, runId)) } : null;
  };
  async function handler(request, response) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (url.pathname !== "/runtime/agent/projects" && !/^\/runtime\/agent\/runs(?:\/[^/]+)?$/.test(url.pathname)) return false;
    if (closed) { json(response, 503, { error: "Agent service is closing. Reopen saved runs after it returns.", code: "agent_service_closed" }); return true; }
    let identity, owner, modelOwner, projectIdForModel, expiryTimer, identityTimer, operation, pendingRun, modelContext;
    const pendingEvents = [];
    let finished = false, checking = false;
    const clientController = new AbortController(),
      abortClient = () => clientController.abort(request.maintenanceSignal?.reason || fault("The request was cancelled.", "agent_request_cancelled", 499));
    const identityChanged = () => fault("The Wallet session changed or expired. Sign in again before continuing.", "agent_identity_changed", 401);
    const sameIdentity = (value) => value && ["owner", "workspaceOwner", "account", "generation", "identityReference"].every(key => value[key] === identity[key]);
    function assertCurrent() {
      if (closed) throw fault("Agent service is closing. Reopen saved runs after it returns.", "agent_service_closed", 503);
      if (clientController.signal.aborted) throw clientController.signal.reason || identityChanged();
      try {
        if (identity && (identity.expiresAt <= Date.now() || identity.isCurrent() === false)) throw identityChanged();
      } catch (error) {
        clientController.abort(error); throw error;
      }
    }
    async function checkIdentity() {
      try {
        assertCurrent();
        if (verifyIdentity) {
          const current = await verifyIdentity(request);
          if (!sameIdentity(current) || !validIdentity(current) || await current.isCurrent() === false) throw identityChanged();
        }
        assertCurrent();
      } catch (error) {
        clientController.abort(error); throw error;
      }
    }
    const append = (...args) => { assertCurrent(); if (pendingRun) { pendingEvents.push(args); return; } return appendEvent(...args); };
    function persist(value) { assertCurrent(); pendingRun = value; }
    function commitPendingResult() {
      assertCurrent();
      atomic(() => {
        if (pendingRun) saveRun(owner, operation.runId, pendingRun);
        for (const args of pendingEvents) appendEvent(...args);
        finishOperation.run("finished", new Date().toISOString(), null, owner, operation.runId, operation.operationId);
        db.prepare("UPDATE agent_operations SET write_intent=NULL WHERE owner_id=? AND run_id=? AND operation_id=?")
          .run(owner, operation.runId, operation.operationId);
      });
      operation = null; pendingRun = null; pendingEvents.length = 0;
    }
    function saveWriteIntent(current, payload, intent) {
      assertCurrent();
      const idempotencyKey = `agent-${operation.runId}-${operation.operationId}`;
      const value = { ...intent, idempotencyKey, expectedRevision: current.workspaceRevision,
        requestHash: sha(`${current.workspaceRevision}:${JSON.stringify(payload)}`) };
      db.prepare("UPDATE agent_operations SET write_intent=? WHERE owner_id=? AND run_id=? AND operation_id=? AND status='running'")
        .run(stable(value), owner, operation.runId, operation.operationId);
      return idempotencyKey;
    }
    function beginRunOperation(runId, action) {
      assertCurrent(); recoverOperations();
      const previous = readOperation.get(owner, runId);
      if (previous?.write_intent) {
        const intent = JSON.parse(previous.write_intent), row = getRun.get(owner, runId);
        if (!workspaceStore.mutationReceipt)
          throw fault("Saved write verification is unavailable. Preserve this run until it returns.", "agent_write_recovery_unavailable", 503);
        const receipt = workspaceStore.mutationReceipt(owner, row.project_id, intent.idempotencyKey);
        if (receipt && (receipt.requestHash !== intent.requestHash || receipt.revision !== intent.expectedRevision + 1))
          throw fault("The saved workspace write receipt does not match. Preserve the run for recovery.", "agent_write_recovery_mismatch", 409);
      }
      if (previous?.status === "interrupted" && previous.action === "approve-git" && previous.recovery_evidence && JSON.parse(previous.recovery_evidence).recheckRequired && action !== "reconcile-git")
        throw fault("Read the repository state before preparing another commit.", "git_recovery_required", 409);
      const operationId = randomUUID(), now = new Date().toISOString();
      if (!claimOperation.run(owner, runId, operationId, instanceId, process.pid, action, now, now).changes)
        throw fault("This saved run still has an operation in progress. Refresh its status before continuing.", "agent_run_busy", 409);
      operation = { runId, operationId, ...(action === "reconcile-git" ? { previous } : {}) };
    }
    function settleRunOperation(status = "finished", errorCode = null) {
      if (!operation || databaseClosed) return;
      finishOperation.run(status, new Date().toISOString(), errorCode, owner, operation.runId, operation.operationId);
      if (status === "interrupted" && operation.previous?.action === "approve-git")
        db.prepare("UPDATE agent_operations SET action='approve-git',recovery_evidence=? WHERE owner_id=? AND run_id=? AND operation_id=?")
          .run(operation.previous.recovery_evidence, owner, operation.runId, operation.operationId);
      operation = null;
    }
    function assertTextProject(projectId) {
      if (workspaceStore.storageMode?.(owner, projectId) === "native-volume")
        throw fault("This project uses native workspace files. Open its native IDE Tools to review current files.", "agent_native_tools_required", 409);
    }
    function bindModelContext(current, workspace, paths = current.approvedPaths) {
      if (workspace.revision !== current.workspaceRevision)
        throw fault('The approved project context changed. Review its current revision before another model request.', 'agent_context_changed', 409);
      modelContext = { revision: workspace.revision, attachments: validatedModelAttachments(paths.map(path => ({
        id: sha(`${current.projectId}:${workspace.revision}:${path}:${sha(workspace.files[path] || '')}`),
        name: path, mimeType: path.endsWith('.json') ? 'application/json' : path.endsWith('.md') ? 'text/markdown' : 'text/plain',
        text: workspace.files[path],
      }))) };
      return modelContext.attachments.map(file => `--- ${file.name} sha256=${sha(file.text)} bytes=${Buffer.byteLength(file.text)} (explicit attached source) ---`).join('\n');
    }
    function assertModelContextCurrent() {
      if (modelContext && workspaceStore.get(owner, projectIdForModel)?.revision !== modelContext.revision)
        throw fault('The approved project context changed during the model operation.', 'agent_context_changed', 409);
    }
    // Every model role, including repair attempts, uses the same identity,
    // project and durable conversation admission boundary.
    const ownerModelRouter = {
      async generate(input) {
        await checkIdentity();
        assertTextProject(projectIdForModel);
        assertModelContextCurrent();
        input = { ...input, attachments: modelContext?.attachments || [] };
        const hosted = (input.provider || "ynx-hosted").toLowerCase() === "ynx-hosted";
        if (hosted && verifyIdentity && !aiStore)
          throw fault("Saved AI requests are not configured for this product.", "agent_ai_store_unavailable", 503);
        let conversation;
        if (hosted && aiStore) {
          const request = existingHostedRequest({ ...input, hostedSession: '00000000-0000-4000-8000-000000000000' });
          const context = request.attachments.length ? JSON.stringify({ prompt: request.prompt, attachments: request.attachments,
            includedContext: request.includedContext, excludedContext: request.excludedContext }) : request.prompt;
          conversation = aiStore.create({ owner: modelOwner, projectId: projectIdForModel,
            prompt: `YNX Code ${input.role} Agent`, context, model: input.model || "qwen3:4b" });
        }
        try {
          const result = await waitForOperation(() => modelRouter.generate({ ...input, ownerId: modelOwner,
            ...(conversation ? { hostedSession: conversation.id } : {}), signal: clientController.signal,
            assertCurrent: async () => { await checkIdentity(); assertModelContextCurrent(); } }), clientController.signal);
          await checkIdentity();
          assertTextProject(projectIdForModel);
          assertModelContextCurrent();
          if (conversation) aiStore.complete(modelOwner, projectIdForModel, conversation.id, { text: result.text, model: result.model });
          return { ...result, ...(conversation ? { conversationId: conversation.id, saved: true } : {}) };
        } catch (error) {
          if (conversation) aiStore.fail(modelOwner, projectIdForModel, conversation.id, { code:
            typeof error.code === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(error.code) ? error.code : "model_request_failed" });
          throw error;
        }
      },
    };
    request.once("aborted", abortClient);
    request.maintenanceSignal?.addEventListener("abort", abortClient, { once: true });
    const closeResponse = () => { if (!response.writableEnded) abortClient(); };
    response.once("close", closeResponse);
    controllers.add(clientController);
    try {
      if (verifyIdentity) {
        identity = await verifyIdentity(request);
        if (!validIdentity(identity) || await identity.isCurrent() === false)
          throw fault("A signed workspace session is required.", "workspace_session_required", 401);
        if (url.pathname !== "/runtime/agent/projects") assertExpectedIdentity(request, identity);
        owner = identity.workspaceOwner; modelOwner = identity.owner;
        expiryTimer = setTimeout(() => clientController.abort(identityChanged()), Math.max(1, Math.min(identity.expiresAt - Date.now(), 2147483647)));
        identityTimer = setInterval(() => {
          if (checking || finished) return;
          checking = true;
          void checkIdentity().catch(error => { if (!finished) clientController.abort(error); }).finally(() => { checking = false; });
        }, 500);
      } else {
        owner = await ownerForRequest?.(request); modelOwner = owner;
        if (!owner) throw fault("A signed workspace session is required.", "workspace_session_required", 401);
      }
      if (request.aborted || response.destroyed || request.maintenanceSignal?.aborted) abortClient();
      await checkIdentity();
      if (url.pathname === "/runtime/agent/projects") {
        if (request.method !== "GET") throw fault("Method not allowed.", "method_not_allowed", 405);
        const projects = workspaceStore.listProjects(owner).map(project => ({ projectId: project.projectId, name: project.name,
          revision: project.revision, activePath: workspaceStore.get(owner, project.projectId)?.active || "",
          storageMode: workspaceStore.storageMode?.(owner, project.projectId) || "text-snapshot" }));
        json(response, 200, { protocolVersion: PROTOCOL, account: identity?.account || null, generation: identity?.generation ?? null,
          identityKey: identity ? consumerIdentityBinding(identity) : null, projects });
        return true;
      }
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
          recoverOperations();
          const cursor = decodeCursor(url.searchParams.get("cursor")),
            limit = Math.floor(Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 50))),
            rows = listRuns.all(owner, projectId, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.runId ?? null, limit + 1),
            page = rows.slice(0, limit),
            live = cursor ? [] : db.prepare("SELECT r.* FROM agent_runs r JOIN agent_operations o ON o.owner_id=r.owner_id AND o.run_id=r.run_id WHERE r.owner_id=? AND r.project_id=? AND o.status='running' ORDER BY r.created_at DESC,r.run_id DESC").all(owner, projectId),
            visible = [...new Map([...live, ...page].map(row => [row.run_id, row])).values()],
            last = page.at(-1);
          json(response, 200, {
            protocolVersion: PROTOCOL,
            runs: visible.map(row => ({ ...record(row, []), operation: operationValue(readOperation.get(owner, row.run_id)) })),
            nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ createdAt: last.created_at, runId: last.run_id })).toString("base64url") : null,
          });
        }
        return true;
      }
      if (request.method !== "POST")
        throw fault("Method not allowed.", "method_not_allowed", 405);
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      await checkIdentity();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw fault("Agent request must be an object.", "invalid_agent_request", 400);
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
        projectIdForModel = projectId;
        modelContext = { revision: workspace.revision, attachments: [] };
        assertTextProject(projectId);
        if (body.approval !== "model-request-once")
          throw fault(
            "One-time model request approval is required.",
            "model_request_approval_required",
            403,
          );
        db.exec("BEGIN IMMEDIATE");
        try {
          claimApproval(
          owner,
          body.approvalId,
          "model-network",
          runId,
          getApproval,
          insertApproval,
          );
          const now = new Date().toISOString();
          insertRun.run(owner, runId, projectId, "planning", String(body.provider || "ynx-hosted"), String(body.model || ""), intent, workspace.revision, null, now, now);
          beginRunOperation(runId, "create");
          append(owner, runId, "permission.decision", { permission: "model-network", decision: "granted", approval: "model-request-once", approvalId: body.approvalId, requestAction: "create" });
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); operation = null; throw error; }
        const model = await ownerModelRouter.generate(
            modelInput(
              body,
              "Planner",
              `Create a concise implementation plan for this request. Return JSON only as {\"summary\":string,\"steps\":[{\"title\":string,\"acceptance\":string}],\"contextPaths\":[string],\"createPaths\":[string],\"deletePaths\":[string]}. contextPaths must name existing files to read. createPaths must name only necessary new files. deletePaths must name existing files whose removal is necessary and recoverable. Available paths: ${Object.keys(workspace.files).join(", ")}\nRequest: ${intent}`,
              clientController.signal,
            ),
          ),
          plan = validatePlan(parseJson(model.text), workspace.files);
        await checkIdentity();
        persist({ ...read(owner, runId), status: "plan_review", provider: model.provider, model: model.model, plan });
        append(owner, runId, "planner.completed", {
          ...modelEvidence(model),
          approval: "model-request-once",
          approvalId: body.approvalId,
          plan,
        });
        commitPendingResult();
        json(response, 201, {
          protocolVersion: PROTOCOL,
          run: read(owner, runId),
        });
        return true;
      }
      let current;
      db.exec("BEGIN IMMEDIATE");
      try {
        current = read(owner, id);
        if (!current) throw fault("Agent run not found.", "agent_run_not_found", 404);
        beginRunOperation(id, text(body.action, 1, 64, "action"));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); operation = null; throw error; }
      projectIdForModel = current.projectId;
      assertTextProject(current.projectId);
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
        // Reject unsupported selections while the user can still edit context.
        bindModelContext(current, workspace, paths);
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
        const context = bindModelContext(current, workspace),
          memory = projectMemory
            ? await projectMemory
                .search(
                  owner,
                  current.projectId,
                  current.intent,
                  8,
                  current.approvedPaths,
                  { assertCurrent: checkIdentity },
                )
                .catch(() => null)
            : null,
          memoryContext =
            memory?.indexedRevision === workspace.revision
              ? 'Semantic matches refer only to the explicitly attached approved files.'
              : "",
          generated = await generateValidatedProposal(
            ownerModelRouter,
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
            ownerModelRouter,
            body,
            `Review this proposed patch against the attached approved source for correctness, security, and missing tests. Return JSON only as {\"approved\":boolean,\"summary\":string,\"findings\":[string]}.\nIntent: ${current.intent}\nProposal: ${stable(generated.patch)}`,
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
        const context = bindModelContext(current, workspace),
          generated = await generateValidatedProposal(
            ownerModelRouter,
            body,
            `Revise the rejected patch to satisfy the user intent and every Reviewer finding. Preserve all unrelated imports, declarations, and behavior. Prefer the smallest exact replacement. Return JSON only as {"summary":string,"edits":[{"path":string,"expectedDigest":string,"replacements":[{"find":string,"replace":string}]}],"creates":[{"path":string,"content":string}],"deletes":[{"path":string,"expectedDigest":string}]}.\nIntent: ${current.intent}\nRejected proposal paths: ${stable(current.proposal.files.map(file => ({path:file.path,operation:file.operation,digest:sha(file.content)})))}\nReviewer: ${stable(current.review)}\nApproved context:\n${context}`,
            workspace.files,
            current.approvedPaths,
            current.approvedCreatePaths,
            current.approvedDeletePaths,
          ),
          coder = generated.coder,
          proposal = generated.proposal,
          reviewed = await generateValidatedReview(
            ownerModelRouter,
            body,
            `Review this revised patch against the exact user intent and attached approved source. Approve a minimal behavior-preserving edit when it satisfies the request. Return JSON only as {"approved":boolean,"summary":string,"findings":[string]}.\nIntent: ${current.intent}\nApproved source:\n${context}\nRevised proposal: ${stable(generated.patch)}`,
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
          payload = {
              name: workspace.name,
              files,
              folders,
              open: workspace.open.filter((path) => Object.hasOwn(files, path)),
              active: Object.hasOwn(files, workspace.active)
                ? workspace.active
                : Object.keys(files).sort()[0],
            };
        const trash = [
          ...(current.trash || []),
          ...deleted.map((file) => ({
            ...file,
            deletedRevision: workspace.revision + 1,
          })),
        ];
        const appliedEvent = { approval: "write-once", attempt: applyAttempt,
          files: current.proposal.files.map(file => ({ path: file.path, operation: file.operation })) };
        const idempotencyKey = saveWriteIntent(current, payload, { targetStatus: "applied", trash,
          event: { type: "write.applied", payload: appliedEvent } });
        const saved = workspaceStore.put(owner, current.projectId, { expectedRevision: workspace.revision, idempotencyKey, payload });
        persist({
          ...current,
          status: "applied",
          trash,
          workspaceRevision: saved.revision,
        });
        append(owner, id, "write.applied", { ...appliedEvent, revision: saved.revision });
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
        const payload = {
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
          trash = (current.trash || []).filter(
            (file) => !requested.includes(file.path),
          );
        const restoredEvent = { approval: "restore-once", files: requested.map(path => ({ path, digest: available.get(path).digest })) };
        const idempotencyKey = saveWriteIntent(current, payload, { targetStatus: "restored", trash, clearReviews: true,
          event: { type: "trash.restored", payload: restoredEvent } });
        const saved = workspaceStore.put(owner, current.projectId, { expectedRevision: latest.revision, idempotencyKey, payload });
        persist({
          ...current,
          status: "restored",
          deployment: null,
          gitOperation: null,
          trash,
          workspaceRevision: saved.revision,
        });
        append(owner, id, "trash.restored", { ...restoredEvent, revision: saved.revision });
      } else if (body.action === "run-test") {
        requireStateOneOf(current, ["applied", "restored"]);
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
        }, undefined, { signal: clientController.signal, assertCurrent: checkIdentity });
        await checkIdentity();
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
          context = bindModelContext(current, latest, fixPaths),
          generated = await generateValidatedProposal(
            ownerModelRouter,
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
            ownerModelRouter,
            body,
            `Review whether this fix addresses the exact Tester evidence and attached source without unrelated changes. Return JSON only as {\"approved\":boolean,\"summary\":string,\"findings\":[string]}.\nFailure: ${failure.output}\nFix: ${stable(generated.patch)}`,
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
        const status = await gitService.runForOwner(owner, current.projectId, null, { signal: clientController.signal, assertCurrent: checkIdentity }),
          message = body.message
            ? text(body.message, 1, 4096, "commit message")
            : `Agent: ${current.intent.slice(0, 72)}`,
          files = gitReviewFiles(status, latest, current.trash);
        await checkIdentity();
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
          status = await gitService.runForOwner(owner, current.projectId, null, { signal: clientController.signal, assertCurrent: checkIdentity });
        await checkIdentity();
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
        let committed;
        try {
          db.prepare("UPDATE agent_operations SET recovery_evidence=? WHERE owner_id=? AND run_id=? AND operation_id=?")
            .run(stable({ recheckRequired: true, repositoryMayHaveChanged: true }), owner, id, operation.operationId);
          committed = await gitService.runForOwner(
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
            { signal: clientController.signal, assertCurrent: checkIdentity },
          );
          await checkIdentity();
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
          // Preserve bounded process evidence even when the Wallet was revoked after Git ran.
          const details = error.details || {};
          db.prepare("UPDATE agent_operations SET recovery_evidence=? WHERE owner_id=? AND run_id=? AND operation_id=?")
            .run(stable({ recheckRequired: true, repositoryMayHaveChanged: true,
              ...(committed || details.completedOperation === "commit-reviewed" ? { completedOperation: "commit-reviewed" } : {}),
              ...(Number.isInteger(details.childExitCode) ? { childExitCode: details.childExitCode } : {}) }), owner, id, operation.operationId);
          appendEvent(owner, id, "git.commit_failed", {
            previewDigest: preview.previewDigest,
            code: error.code || "git_operation_failed",
          });
          throw error;
        }
      } else if (body.action === "reconcile-git") {
        const recovered = await inspectAgentGitRecovery({ owner, run: { ...current, workspaceOwner: owner },
          workspaceStore, gitService, signal: clientController.signal, assertCurrent: checkIdentity });
        await checkIdentity();
        persist({ ...current, ...recovered });
        append(owner, id, "git.reconciled", recovered.gitOperation.recovery);
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
      commitPendingResult();
      json(response, 200, { protocolVersion: PROTOCOL, run: read(owner, id) });
      return true;
      function authorize(permission, expected, message, code) {
        assertCurrent();
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
      settleRunOperation("interrupted", typeof error.code === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(error.code) ? error.code : "agent_operation_failed");
      if (!closed && request.maintenanceSignal?.aborted && owner) {
        let mayRecord = !verifyIdentity;
        if (verifyIdentity) {
          try {
            const current = await verifyIdentity(request);
            mayRecord = sameIdentity(current) && validIdentity(current) && await current.isCurrent() !== false;
          } catch { mayRecord = false; }
        }
        const runId = url.pathname.split("/")[4];
        if (mayRecord && runId && getRun.get(owner, runId)) appendEvent(owner, runId, "operation.maintenance_interrupted", {
          reason: "service_maintenance", outcome: "inspect-latest-state", retry: "Reload the saved run and explicitly approve the next operation.",
        });
      }
      if (response.destroyed || response.writableEnded) return true;
      json(response, error.code === "provider_auth_failed" ? 503 : error.code === "provider_key_required" ? 400 : error.status || 400, {
        error: error.message || "Agent operation failed.",
        code: error.code || "agent_operation_failed",
      });
      return true;
    } finally {
      settleRunOperation("interrupted", "agent_request_interrupted");
      finished = true; clearTimeout(expiryTimer); clearInterval(identityTimer);
      request.removeListener("aborted", abortClient);
      response.removeListener("close", closeResponse);
      request.maintenanceSignal?.removeEventListener("abort", abortClient);
      controllers.delete(clientController); closeWhenDrained();
    }
  }
  return { handler, read, close: () => {
    if (!closePromise) closePromise = new Promise(resolve => { resolveClose = resolve; });
    closed = true;
    for (const controller of controllers) controller.abort(fault("Agent service is closing. Reopen saved runs after it returns.", "agent_service_closed", 503));
    closeWhenDrained(); return closePromise;
  } };
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
function operationValue(row) {
  return row ? { status: row.status, action: row.action, startedAt: row.started_at, updatedAt: row.updated_at, ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.recovery_evidence ? { recoveryEvidence: JSON.parse(row.recovery_evidence) } : {}) } : null;
}
function decodeCursor(value) {
  if (!value) return null;
  try {
    if (value.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || typeof cursor.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor.createdAt) ||
      typeof cursor.runId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(cursor.runId)) throw Error();
    return cursor;
  } catch { throw fault("Saved-run cursor is invalid.", "invalid_agent_cursor", 400); }
}
function validIdentity(value) {
  return value && ["owner", "workspaceOwner", "account", "identityReference"].every(key => typeof value[key] === "string" && value[key].length > 0) &&
    (typeof value.generation === "string" || Number.isSafeInteger(value.generation)) &&
    Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() && typeof value.isCurrent === "function";
}
function waitForOperation(start, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(signal.reason || fault("The request was cancelled.", "agent_request_cancelled", 499));
    if (signal.aborted) { cancelled(); return; }
    signal.addEventListener("abort", cancelled, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return start(); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", cancelled));
  });
}
function modelInput(body, role, prompt, signal) {
  const limits = { Planner: 384, Coder: 1024, Reviewer: 512 };
  return {
    role,
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
    ...(result?.conversationId ? { conversationId: result.conversationId, saved: result.saved === true } : {}),
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
        patch: parseJson(coder.text),
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
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
export const AGENT_PROTOCOL = PROTOCOL;
