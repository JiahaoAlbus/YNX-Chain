import { invariant } from "./errors.js";

export const AI_BUILD_STAGES = Object.freeze([
  "intent", "plan", "review", "explore", "context", "edit", "diff", "test",
  "build", "fix", "package", "deploy-review", "checkpoint", "revert", "audit",
]);

export const AI_BUILD_PERMISSIONS = Object.freeze([
  "read", "write", "execute", "network", "package-install", "secret-reference",
  "git-commit", "git-push", "deploy",
]);

const HIGH_RISK = new Set(["write", "execute", "network", "package-install", "secret-reference", "git-commit", "git-push", "deploy"]);
const TERMINAL = new Set(["completed", "cancelled", "failed", "reverted"]);
const clone = (value) => structuredClone(value);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const iso = (clock) => new Date(clock()).toISOString();

function safeText(value, limit = 4000) { return String(value ?? "").trim().slice(0, limit); }
function exactPermission(value) { invariant(AI_BUILD_PERMISSIONS.includes(value), "invalid_ai_build_permission", `Unknown YNX AI Build permission: ${value}`); return value; }
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => /token|secret|password|private.?key|authorization/i.test(key) ? [key, "[redacted]"] : [key, redact(item)]));
}

export class AIBuildRun {
  constructor({ intent, provider = "ynx-gateway", model = "gateway-policy", outputLanguage = "en", clock = Date.now, restored } = {}) {
    this.clock = clock;
    if (restored) { this.state = clone(restored); this.#validateRestore(); return; }
    intent = safeText(intent);
    invariant(intent.length >= 4, "invalid_ai_build_intent", "YNX AI Build intent must contain at least four characters.");
    invariant(/^[a-z]{2}(?:-[A-Z]{2})?$/.test(outputLanguage), "invalid_output_language", "AI output language is invalid.");
    const at = iso(clock);
    this.state = {
      schemaVersion: 1, runId: id("ai_build"), status: "planning", stage: "intent", intent,
      provider: safeText(provider, 120), model: safeText(model, 120), outputLanguage,
      createdAt: at, updatedAt: at, plan: [], approvedContext: [], permissions: {},
      proposals: [], toolTimeline: [], tests: [], artifacts: [], checkpoints: [], audit: [],
      lastError: null, usage: { inputTokens: null, outputTokens: null, providerCost: null, estimateOnly: true },
    };
    this.#audit("run.created", { intentBytes: new TextEncoder().encode(intent).byteLength, provider: this.state.provider, model: this.state.model });
  }

  snapshot() { return clone(this.state); }
  exportAudit() { return JSON.stringify({ schemaVersion: 1, runId: this.state.runId, exportedAt: iso(this.clock), events: redact(this.state.audit), toolTimeline: redact(this.state.toolTimeline) }, null, 2); }

  setPlan(steps) {
    this.#active(); invariant(Array.isArray(steps) && steps.length > 0 && steps.length <= 40, "invalid_ai_build_plan", "Plan requires 1-40 bounded steps.");
    this.state.plan = steps.map((step, index) => ({ id: `step-${index + 1}`, title: safeText(step, 240), status: "pending" }));
    invariant(this.state.plan.every((step) => step.title), "invalid_ai_build_plan", "Plan steps cannot be empty.");
    this.#transition("plan", "review"); this.state.status = "review-required"; this.#audit("plan.proposed", { steps: this.state.plan.length }); return this.snapshot();
  }

  approvePlan(decision) {
    invariant(this.state.status === "review-required" && this.state.stage === "review", "plan_review_not_ready", "No AI Build plan is awaiting review.");
    invariant(decision === "approve" || decision === "reject", "invalid_plan_decision", "Choose approve or reject.");
    if (decision === "reject") { this.state.status = "cancelled"; this.#audit("plan.rejected", {}); return this.snapshot(); }
    this.state.status = "running"; this.#transition("review", "explore"); this.#audit("plan.approved", {}); return this.snapshot();
  }

  approveContext(paths) {
    this.#active(); invariant(Array.isArray(paths) && paths.length > 0 && paths.length <= 500, "context_approval_required", "Select 1-500 project paths.");
    const unique = [...new Set(paths.map((path) => safeText(path, 240)))];
    invariant(unique.length === paths.length && unique.every((path) => path && !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\\")), "invalid_context_path", "Context paths must be unique, relative and traversal-free.");
    this.state.approvedContext = unique; this.#transition(this.state.stage, "context"); this.#audit("context.approved", { paths: unique }); return this.snapshot();
  }

  requestPermission(permission, request = {}) {
    this.#active(); permission = exactPermission(permission);
    const requestId = id("permission");
    const record = { requestId, permission, status: "pending", highRisk: HIGH_RISK.has(permission), reason: safeText(request.reason, 500), scope: redact(request.scope ?? null), requestedAt: iso(this.clock), decidedAt: null };
    this.state.permissions[requestId] = record; this.state.status = "permission-required"; this.#audit("permission.requested", record); return clone(record);
  }

  decidePermission(requestId, decision) {
    const item = this.state.permissions[requestId]; invariant(item?.status === "pending", "permission_request_not_found", "Permission request is missing or already decided.");
    invariant(decision === "allow-once" || decision === "deny", "invalid_permission_decision", "Permission decisions are allow-once or deny.");
    item.status = decision; item.decidedAt = iso(this.clock); this.state.status = decision === "allow-once" ? "running" : "paused"; this.#audit(`permission.${decision}`, { requestId, permission: item.permission }); return clone(item);
  }

  consumePermission(requestId, permission) {
    const item = this.state.permissions[requestId]; permission = exactPermission(permission);
    invariant(item?.permission === permission && item.status === "allow-once", "permission_not_granted", `${permission} requires a current one-time approval.`);
    item.status = "consumed"; item.consumedAt = iso(this.clock); this.#audit("permission.consumed", { requestId, permission });
  }

  recordTool({ name, permission = "read", requestId, inputSummary, status, outputSummary, durationMs = null }) {
    this.#active(); permission = exactPermission(permission);
    if (HIGH_RISK.has(permission)) this.consumePermission(requestId, permission);
    invariant(["passed", "failed", "cancelled"].includes(status), "invalid_tool_status", "Tool status must be passed, failed or cancelled.");
    const event = { id: id("tool"), at: iso(this.clock), name: safeText(name, 120), permission, inputSummary: safeText(inputSummary, 500), status, outputSummary: safeText(outputSummary, 1000), durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : null };
    this.state.toolTimeline.push(event); this.#audit("tool.recorded", { toolId: event.id, name: event.name, permission, status }); return clone(event);
  }

  proposeDiff(files, summary = "") {
    this.#active(); invariant(Array.isArray(files) && files.length > 0 && files.length <= 100, "invalid_ai_build_diff", "A proposal requires 1-100 files.");
    const normalized = files.map(({ path, before = "", after = "" }) => ({ path: safeText(path, 240), before: String(before), after: String(after) }));
    invariant(normalized.every((file) => this.state.approvedContext.includes(file.path) || file.before === ""), "context_scope_violation", "AI Build may edit approved paths or explicitly reviewed new files only.");
    const proposal = { id: id("proposal"), at: iso(this.clock), summary: safeText(summary, 500), files: normalized, status: "review-required" };
    this.state.proposals.push(proposal); this.state.status = "review-required"; this.#transition(this.state.stage, "diff"); this.#audit("diff.proposed", { proposalId: proposal.id, paths: normalized.map((file) => file.path) }); return clone(proposal);
  }

  reviewDiff(proposalId, decision) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId); invariant(proposal?.status === "review-required", "proposal_not_reviewable", "Proposal is missing or already reviewed.");
    invariant(decision === "approve" || decision === "reject", "invalid_diff_decision", "Choose approve or reject.");
    proposal.status = decision === "approve" ? "approved-for-apply" : "rejected"; proposal.reviewedAt = iso(this.clock); this.state.status = decision === "approve" ? "permission-required" : "running"; this.#audit(decision === "approve" ? "diff.approved" : "diff.rejected", { proposalId }); return clone(proposal);
  }

  applyDiff(proposalId, requestId, apply) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId); invariant(proposal?.status === "approved-for-apply", "proposal_not_approved", "Only a reviewed proposal can be applied.");
    invariant(typeof apply === "function", "apply_callback_required", "A bounded project apply callback is required."); this.consumePermission(requestId, "write");
    apply(clone(proposal.files)); proposal.status = "applied"; proposal.appliedAt = iso(this.clock); this.state.status = "running"; this.#transition("diff", "test"); this.#audit("diff.applied", { proposalId, paths: proposal.files.map((file) => file.path) }); return clone(proposal);
  }

  recordTest({ name, status, command = null, evidence = null }) { this.#active(); invariant(["passed", "failed", "skipped"].includes(status), "invalid_test_status", "Test status is invalid."); const item = { id: id("test"), at: iso(this.clock), name: safeText(name, 240), status, command: safeText(command, 500) || null, evidence: safeText(evidence, 1000) || null }; this.state.tests.push(item); this.#audit("test.recorded", { testId: item.id, status }); return clone(item); }
  recordArtifact({ name, kind, path, sha256 = null, truthfulStatus = "built-local" }) { this.#active(); const item = { id: id("artifact"), at: iso(this.clock), name: safeText(name, 240), kind: safeText(kind, 80), path: safeText(path, 500), sha256: sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null, truthfulStatus: safeText(truthfulStatus, 120) }; this.state.artifacts.push(item); this.#audit("artifact.recorded", { artifactId: item.id, truthfulStatus: item.truthfulStatus }); return clone(item); }

  checkpoint(label, files) { this.#active(); label = safeText(label, 80); invariant(label.length >= 2 && files && typeof files === "object", "invalid_ai_build_checkpoint", "Checkpoint requires a label and files."); const checkpoint = { id: id("ai_checkpoint"), at: iso(this.clock), label, files: clone(files) }; this.state.checkpoints.push(checkpoint); this.#transition(this.state.stage, "checkpoint"); this.#audit("checkpoint.created", { checkpointId: checkpoint.id, label }); return clone(checkpoint); }
  revert(checkpointId, requestId, apply) { this.#active(); const checkpoint = this.state.checkpoints.find((item) => item.id === checkpointId); invariant(checkpoint, "ai_checkpoint_not_found", "AI Build checkpoint does not exist."); this.consumePermission(requestId, "write"); apply(clone(checkpoint.files)); this.state.status = "reverted"; this.state.stage = "revert"; this.#audit("checkpoint.reverted", { checkpointId }); return this.snapshot(); }
  pause(reason = "Paused by user") { this.#active(); this.state.status = "paused"; this.#audit("run.paused", { reason: safeText(reason, 500) }); return this.snapshot(); }
  resume() { invariant(this.state.status === "paused" || this.state.status === "failed", "run_not_resumable", "Only paused or failed runs can resume."); this.state.status = "running"; this.state.lastError = null; this.#audit("run.resumed", {}); return this.snapshot(); }
  cancel() { this.#active(); this.state.status = "cancelled"; this.#audit("run.cancelled", {}); return this.snapshot(); }
  fail(error) { this.#active(); this.state.status = "failed"; this.state.lastError = safeText(error instanceof Error ? error.message : error, 1000); this.#audit("run.failed", { error: this.state.lastError }); return this.snapshot(); }
  complete() { this.#active(); invariant(this.state.proposals.every((item) => item.status !== "review-required" && item.status !== "approved-for-apply"), "unresolved_ai_build_review", "Resolve every proposal before completion."); this.state.status = "completed"; this.state.stage = "audit"; this.#audit("run.completed", { tests: this.state.tests.length, artifacts: this.state.artifacts.length }); return this.snapshot(); }

  #active() { invariant(!TERMINAL.has(this.state.status), "ai_build_run_terminal", `Run is already ${this.state.status}.`); }
  #transition(from, to) { invariant(AI_BUILD_STAGES.includes(to), "invalid_ai_build_stage", `Invalid AI Build stage: ${to}`); this.state.stage = to; this.state.updatedAt = iso(this.clock); this.#audit("stage.changed", { from, to }); }
  #audit(event, details) { const entry = { sequence: this.state.audit.length + 1, id: id("audit"), at: iso(this.clock), event, details: redact(details), previous: this.state.audit.at(-1)?.id ?? null }; this.state.audit.push(entry); this.state.updatedAt = entry.at; }
  #validateRestore() { invariant(this.state?.schemaVersion === 1 && typeof this.state.runId === "string" && AI_BUILD_STAGES.includes(this.state.stage) && Array.isArray(this.state.audit), "invalid_ai_build_restore", "Saved AI Build run is invalid."); invariant(this.state.audit.every((entry, index) => entry.sequence === index + 1 && entry.previous === (index ? this.state.audit[index - 1].id : null)), "invalid_ai_build_audit_chain", "Saved AI Build audit chain is invalid."); }
}

export class AIBuildPersistence {
  constructor(storage, key = "ynx.developer.ai-build.v1") { this.storage = storage; this.key = key; }
  save(run) { const value = run instanceof AIBuildRun ? run.snapshot() : clone(run); this.storage.setItem(this.key, JSON.stringify(value)); }
  load(options = {}) { const raw = this.storage.getItem(this.key); return raw ? new AIBuildRun({ ...options, restored: JSON.parse(raw) }) : null; }
  clear() { this.storage.removeItem(this.key); }
}

export const GROK_BUILD_ACP = Object.freeze({
  productName: "YNX AI Build", protocol: "ACP", transport: "stdio", command: "grok", args: ["agent", "stdio"],
  upstream: "https://github.com/xai-org/grok-build", commit: "98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce",
  sourceRev: "124d85bc5dc6e7805560215fcc6d5413944920e1", upstreamVersion: "0.2.102", affiliationClaim: false,
});
