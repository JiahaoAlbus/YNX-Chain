import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { consumerIdentityBinding } from "../../codeoss-service/src/identity-consumer-binding.mjs";
import { createModelRouter } from "../src/router.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t, { holdHealth = false, localCheck = true } = {}) {
  let active = { owner: "identity-a", workspaceOwner: "workspace-a", account: "account-a",
    generation: 1, identityReference: "reference-a", expiresAt: Date.now() + 60_000 };
  let guestCalls = 0, healthCalls = 0, verificationError;
  const healthEntered = deferred(), releaseHealth = deferred();
  const identity = () => {
    const captured = active && { ...active };
    if (!captured) return null;
    return { ...captured, isCurrent() {
      if (localCheck && (!active || ["owner", "workspaceOwner", "account", "generation", "identityReference"].some(key => active[key] !== captured[key])))
        throw Object.assign(new Error("Wallet changed"), { status: 401, code: "core_identity_changed" });
      // The production verifier succeeds with undefined, not boolean true.
    } };
  };
  const router = createModelRouter({
    ownerForRequest() { guestCalls++; return null; },
    verifyIdentity: async () => { if (verificationError) throw verificationError; return identity(); },
    fetchImpl: async url => {
      assert.ok(String(url).endsWith("/health"));
      healthCalls++; healthEntered.resolve();
      if (holdHealth) await releaseHealth.promise;
      return Response.json({ available: true, model: "fixture-private-model" });
    },
  });
  const server = createServer(async (request, response) => {
    if (!await router.handler(request, response)) response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { releaseHealth.resolve(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/runtime/models`;
  return { url, identity, binding: () => consumerIdentityBinding(identity()),
    get: binding => fetch(url, { headers: binding ? { "x-ynx-agent-identity": binding } : {} }),
    replace: changes => { active = active ? { ...active, ...changes } : changes; },
    signOut: () => { active = null; }, unavailable: () => { verificationError = Object.assign(new Error("Central unavailable"), { status: 503, code: "core_identity_unavailable" }); },
    guestCalls: () => guestCalls, healthCalls: () => healthCalls, healthEntered, releaseHealth };
}

test("model catalog admits a verified Wallet without a guest cookie and accepts assertion-style isCurrent", async t => {
  const f = await fixture(t);
  const response = await f.get(f.binding());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hosted.model, "fixture-private-model");
  assert.equal(f.guestCalls(), 0); assert.equal(f.healthCalls(), 1);
});

test("model catalog rejects missing or stale actor binding before checking provider health", async t => {
  const f = await fixture(t), prior = f.binding();
  assert.equal((await f.get()).status, 401);
  f.replace({ account: "account-b", generation: 2, identityReference: "reference-b" });
  assert.equal((await f.get(prior)).status, 401);
  assert.equal(f.healthCalls(), 0); assert.equal(f.guestCalls(), 0);
});

test("late model health cannot revive a changed Wallet catalog even when the local assertion is still current", async t => {
  const f = await fixture(t, { holdHealth: true, localCheck: false });
  const pending = f.get(f.binding()); await f.healthEntered.promise;
  f.replace({ identityReference: "reference-replaced" }); f.releaseHealth.resolve();
  const response = await pending;
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /fixture-private-model/);
  assert.equal(f.guestCalls(), 0);
});

test("model catalog preserves verification unavailability and never retries through guest admission", async t => {
  const f = await fixture(t), binding = f.binding();
  f.unavailable(); const response = await f.get(binding);
  assert.equal(response.status, 503); assert.equal((await response.json()).code, "core_identity_unavailable");
  assert.equal(f.healthCalls(), 0); assert.equal(f.guestCalls(), 0);
});

test("model catalog rejects sign-out during health and absent verified identity", async t => {
  const f = await fixture(t, { holdHealth: true });
  const binding = f.binding(), pending = f.get(binding); await f.healthEntered.promise;
  f.signOut(); f.releaseHealth.resolve();
  assert.equal((await pending).status, 401);
  assert.equal((await f.get(binding)).status, 401);
  assert.equal(f.healthCalls(), 1); assert.equal(f.guestCalls(), 0);
});

test("catalog retains the explicit legacy adapter only when no Wallet verifier is configured", async t => {
  const router = createModelRouter({ ownerForRequest: request => request.headers["x-test-owner"],
    fetchImpl: async () => Response.json({ available: true }) });
  const server = createServer(async (request, response) => { await router.handler(request, response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/runtime/models`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-test-owner": "legacy-owner" } })).status, 200);
});
