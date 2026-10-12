import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createProjectMemory } from "../src/service.mjs";
import { consumerIdentityBinding } from "../../codeoss-service/src/identity-consumer-binding.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const vectors = inputs => inputs.map(() => Array(64).fill(1));

async function fixture(t, embed = async inputs => vectors(inputs)) {
  const root = await mkdtemp(join(tmpdir(), "ynx-memory-identity-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  for (const owner of ["wallet-a", "wallet-b", "guest"]) store.put(owner, "project", {
    expectedRevision: 0, idempotencyKey: `initial-${owner}`,
    payload: { name: owner, files: { "main.ts": `export const owner = "${owner}";` }, folders: [], open: ["main.ts"], active: "main.ts" },
  });
  let active, guestCalls = 0, firstVerification = deferred();
  const signIn = (name = "a") => {
    const id = { owner: `identity-${name}`, workspaceOwner: `wallet-${name}`, account: name, generation: 1,
      identityReference: `session-${name}`, expiresAt: Date.now() + 60_000,
      isCurrent() { if (active !== id) throw Object.assign(new Error("Wallet changed"), { status: 401, code: "identity_changed" }); } };
    active = id; return id;
  };
  signIn();
  const memory = createProjectMemory({ filename: join(root, "memory.sqlite"), workspaceStore: store, embed,
    ownerForRequest() { guestCalls++; return "guest"; },
    verifyIdentity: async () => {
      firstVerification.resolve();
      if (!active) throw Object.assign(new Error("Sign in"), { status: 401, code: "identity_required" });
      return active;
    },
  });
  const server = createServer((req, res) => { void memory.handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); memory.close(); store.close(); await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/runtime/memory/project`;
  const initialKey = consumerIdentityBinding(active);
  const headers = () => ({ "x-ynx-agent-identity": active ? consumerIdentityBinding(active) : initialKey });
  const rebuild = (identityKey = headers()["x-ynx-agent-identity"]) => fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-ynx-agent-identity": identityKey },
    body: JSON.stringify({ protocolVersion: "ynx-code-memory/v1", action: "rebuild", expectedRevision: 1 }) });
  return { memory, store, base, rebuild, signIn, signOut: () => { active = null; }, firstVerification,
    headers, initialKey, guestCalls: () => guestCalls };
}

test("memory HTTP uses verified Wallet workspace and never falls back to the guest cookie", async t => {
  const f = await fixture(t);
  assert.equal((await f.rebuild()).status, 200);
  assert.match(f.memory.exportMemory("wallet-a", "project").chunks[0].content, /wallet-a/);
  assert.equal(f.memory.exportMemory("guest", "project").chunks.length, 0);
  assert.equal(f.memory.exportMemory("wallet-b", "project").chunks.length, 0);
  f.signIn("b");
  const other = await fetch(`${f.base}?q=owner`, { headers: f.headers() });
  assert.equal(other.status, 200); assert.deepEqual((await other.json()).results, []);
  f.signOut();
  assert.equal((await f.rebuild()).status, 401);
  assert.equal(f.guestCalls(), 0);
});

test("memory rejects a Wallet switch while the request body is still arriving", async t => {
  let embeds = 0;
  const f = await fixture(t, async inputs => { embeds++; return vectors(inputs); });
  const response = deferred();
  const request = httpRequest(f.base, { method: "POST", headers: { "content-type": "application/json", ...f.headers() } }, response.resolve);
  request.write('{"protocolVersion":"ynx-code-memory/v1",');
  await f.firstVerification.promise;
  f.signIn("b");
  request.end('"expectedRevision":1}');
  const reply = await response.promise; reply.resume();
  assert.equal(reply.statusCode, 401); assert.equal(embeds, 0);
  assert.equal(f.memory.exportMemory("wallet-a", "project").chunks.length, 0);
  assert.equal(f.memory.exportMemory("wallet-b", "project").chunks.length, 0);
});

test("memory does not commit late embeddings after sign-out", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, async inputs => { entered.resolve(); await release.promise; return vectors(inputs); });
  const pending = f.rebuild(); await entered.promise; f.signOut(); release.resolve();
  assert.equal((await pending).status, 401);
  assert.equal(f.memory.exportMemory("wallet-a", "project").chunks.length, 0);
});

test("memory does not return late search content after an account switch", async t => {
  const entered = deferred(), release = deferred(); let hold = false;
  const f = await fixture(t, async inputs => { if (hold) { entered.resolve(); await release.promise; } return vectors(inputs); });
  assert.equal((await f.rebuild()).status, 200); hold = true;
  const pending = fetch(`${f.base}?q=owner`, { headers: f.headers() }); await entered.promise; f.signIn("b"); release.resolve();
  const response = await pending; assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /export const owner/);
});

test("memory refuses native-volume snapshots before embedding and after adoption during indexing", async t => {
  const entered = deferred(), release = deferred(); let embeds = 0;
  const f = await fixture(t, async inputs => { embeds++; entered.resolve(); await release.promise; return vectors(inputs); });
  const pending = f.rebuild(); await entered.promise;
  const writerToken = "a".repeat(64);
  try {
    f.store.claimWriter("wallet-a", "project", { writerToken, sessionId: "12345678-1234-1234-1234-123456789012", expectedRevision: 1 });
    f.store.markNativeProject("wallet-a", "project", writerToken);
  } finally { release.resolve(); }
  assert.equal((await pending).status, 409);
  assert.equal(f.memory.exportMemory("wallet-a", "project").chunks.length, 0);
  assert.equal((await f.rebuild()).status, 409);
  assert.equal((await fetch(`${f.base}?q=owner`, { headers: f.headers() })).status, 409);
  assert.equal(embeds, 1);
});

test("memory rejects a stale A panel after B signs in before request admission", async t => {
  let embeds = 0;
  const f = await fixture(t, async inputs => { embeds++; return vectors(inputs); });
  f.signIn("b");
  assert.equal((await f.rebuild(f.initialKey)).status, 401);
  assert.equal((await fetch(f.base, { method: "DELETE", headers: { "x-ynx-agent-identity": f.initialKey } })).status, 401);
  assert.equal((await fetch(f.base)).status, 401);
  assert.equal(embeds, 0);
  assert.equal(f.memory.exportMemory("wallet-b", "project").chunks.length, 0);
});
