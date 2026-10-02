import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createGateway } from "../src/gateway.mjs";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../../agent-orchestrator/src/service.mjs";
import { createModelRouter } from "../../model-router/src/router.mjs";
import { createProjectMemory } from "../../project-memory/src/service.mjs";
import { consumerIdentityBinding } from "../../codeoss-service/src/identity-consumer-binding.mjs";

test("composed gateway admits Wallet AI and memory despite a revoked guest, and never substitutes the guest for Wallet", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-gateway-wallet-agent-"));
  const workspaceStore = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") });
  workspaceStore.put("wallet-workspace", "project", { expectedRevision: 0, idempotencyKey: "wallet-initial", payload: {
    name: "Wallet Project", files: { "main.js": "console.log('wallet')" }, folders: [], open: ["main.js"], active: "main.js",
  } });
  const runtime = createWorkspaceRuntime({ root, sessionKey: Buffer.alloc(32, 7), workspaceStore });
  let signedIn = true;
  const identity = { owner: "wallet-identity", workspaceOwner: "wallet-workspace", account: "wallet-account", generation: 1,
    identityReference: "wallet-reference", expiresAt: Date.now() + 60_000, isCurrent() { if (!signedIn) throw Object.assign(new Error("Sign in"), { status: 401 }); } };
  const verifyIdentity = async () => signedIn ? identity : null;
  const modelRouter = createModelRouter({ verifyIdentity, ownerForRequest: runtime.ownerForRequest,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });
  const memory = createProjectMemory({ filename: join(root, "memory.sqlite"), workspaceStore, verifyIdentity, ownerForRequest: runtime.ownerForRequest });
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore, modelRouter, verifyIdentity, ownerForRequest: runtime.ownerForRequest });
  const server = createServer(createGateway({ staticRoot: root, runtime, handlers: [modelRouter.handler, agent.handler, memory.handler] }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); agent.close(); memory.close(); runtime.closeAdmission(); workspaceStore.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const guest = await fetch(`${base}/runtime/health`), cookie = guest.headers.get("set-cookie").split(";")[0];
  runtime.revokeGuestAdmission({ headers: { cookie } });
  assert.equal((await fetch(`${base}/runtime/health`, { headers: { cookie } })).status, 401);
  const headers = { cookie, "x-ynx-agent-identity": consumerIdentityBinding(identity) };
  const projects = await fetch(`${base}/runtime/agent/projects`, { headers });
  assert.equal(projects.status, 200); assert.equal((await projects.json()).projects[0].name, "Wallet Project");
  assert.equal((await fetch(`${base}/runtime/models`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/runtime/memory/project`, { headers })).status, 200);
  const liveGuest = await fetch(`${base}/runtime/health`), liveCookie = liveGuest.headers.get("set-cookie").split(";")[0];
  signedIn = false;
  for (const path of ["agent/projects", "models", "memory/project"]) {
    assert.equal((await fetch(`${base}/runtime/${path}`, { headers: { ...headers, cookie: liveCookie } })).status, 401);
  }
});
