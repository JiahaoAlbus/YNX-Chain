import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("AI Software Engineer exposes Tester-backed deployment review without execution", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  for (const action of ["prepare-deployment", "approve-deployment"])
    assert.ok(
      panel.includes(`"${action}"`) &&
        service.includes(`body.action === "${action}"`),
      `${action} must be wired through UI and orchestrator`,
    );
  assert.match(service, /deployment-review-once/);
  assert.match(service, /review-only-no-network-no-signing/);
  assert.match(service, /executable: false/);
  assert.match(panel, /Execution remains disabled/);
  assert.doesNotMatch(service, /fetch\(|privateKey|mnemonic|sendTransaction/);
});

test("AI model and context evidence is visible without invented cost", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  assert.match(panel, /Requested context/);
  assert.match(panel, /Approved context/);
  assert.match(panel, /input \+.*output tokens/);
  assert.match(panel, /cost unreported by provider/);
  assert.match(client + service, /unreported-by-provider/);
  assert.match(service, /summarizeUsage/);
});

test("AI permissions are explicit, one-time, audited and fail closed", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  for (const approval of [
    "model-request-once",
    "context-read-once",
    "write-once",
    "execute-once",
    "git-local-commit-once",
    "deployment-review-once",
  ]) assert.match(panel + service, new RegExp(approval));
  assert.match(panel, /PERMISSIONS/);
  assert.match(panel, /crypto\.randomUUID/);
  assert.match(client + service, /permissions/);
  assert.match(service, /permission\.decision/);
  assert.match(service, /agent_approvals/);
  assert.match(service, /approval_replayed/);
  for (const disabled of [
    "package-install",
    "git",
    "browser-network",
    "secret-reference",
    "destructive-delete",
    "deployment-execute",
  ]) assert.match(service, new RegExp(disabled));
});

test("AI local Git commit is digest reviewed and remote Git remains disabled", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/agent-orchestrator/src/service.mjs"),
    gateway = await read("services/gateway/src/server.mjs");
  for (const action of ["prepare-git", "approve-git"])
    assert.ok(
      panel.includes(`"${action}"`) &&
        service.includes(`body.action === "${action}"`),
      `${action} must be wired through UI and orchestrator`,
    );
  assert.match(panel + client + service, /git-local-commit-once/);
  assert.match(service, /git\.previewed/);
  assert.match(service, /git\.committed/);
  assert.match(service, /git_preview_stale/);
  assert.match(service, /previewDigest/);
  assert.match(service, /local-only-no-network-no-credentials-no-hooks-no-signing/);
  assert.match(service, /git-remote/);
  assert.match(gateway, /gitService/);
  assert.match(
    panel,
    /No push, pull, PR, credential access or network\s+request occurred/,
  );
});

test("AI create and recoverable delete are exact-path approved", async () => {
  const panel = await read("frontend/src/chat/AgentPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/agent-orchestrator/src/service.mjs");
  assert.match(panel + client + service, /createPaths/);
  assert.match(service, /approved_create_paths/);
  assert.match(service, /validateCreatePaths/);
  assert.match(service, /operation: "create"/);
  assert.match(service, /operation: "delete"/);
  assert.match(service, /trash\.restored/);
  assert.match(service + panel, /restore-once/);
  assert.match(panel, /Recoverable trash/);
  assert.match(panel, /recoverable deletes/);
  assert.match(service, /destructive-delete/);
});
