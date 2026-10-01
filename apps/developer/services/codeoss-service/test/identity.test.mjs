import test from "node:test";
import assert from "node:assert/strict";
import { createCentralIdentityVerifier, CENTRAL_IDENTITY } from "../src/central-identity.mjs";

const now = 1000000000000, sealed = { grantToken: "secret".repeat(10), subject: "nativeynx:alice", account: "ynx1alice", generation: 1 };
const response = () => ({ audience: CENTRAL_IDENTITY.audience, scopes: ["identity:read"], expiresAt: new Date(now + 50000).toISOString(),
  identity: { subject: sealed.subject, account: sealed.account, generation: 1, expiresAt: new Date(now + 50000).toISOString() } });
function verifier(body = response(), status = 200) {
  return createCentralIdentityVerifier({ now: () => now, grantForRequest: async () => sealed,
    workspaceBinding: async ({ owner }) => ({ owner, workspaceOwner: "a".repeat(64) }),
    fetchImpl: async (url, options) => {
      assert.equal(url, CENTRAL_IDENTITY.endpoint);
      assert.equal(options.body, JSON.stringify({ clientId: CENTRAL_IDENTITY.clientId, grantToken: sealed.grantToken }));
      assert.equal(options.headers.cookie, undefined); assert.equal(options.headers.origin, undefined);
      return { ok: status === 200, json: async () => body };
    } });
}
test("server-sealed central identity binds stable subject; caller identity ignored", async () => {
  const a = await verifier()({ headers: { "x-owner": "attacker", cookie: "irrelevant" }, body: { subject: "attacker" } });
  assert.match(a.owner, /^[a-f0-9]{64}$/); assert.equal(a.subject, sealed.subject); assert.equal(a.workspaceOwner, "a".repeat(64));
});
test("expired/revoked/different generation/account/audience/scopes fail closed", async () => {
  const variants = [];
  for (const mutate of [v => { v.expiresAt = new Date(now).toISOString(); }, v => { v.identity.generation = 2; }, v => { v.identity.account = "ynx1other"; },
    v => { v.audience = "ynx:finance:identity"; }, v => { v.scopes.push("developer:deploy"); }]) { const value = response(); mutate(value); variants.push(value); }
  for (const value of variants) await assert.rejects(verifier(value)({}), /identity|account|audience/i);
  await assert.rejects(verifier(response(), 401)({}), { code: "core_identity_invalid" });
});
test("missing backend adapter or explicit workspace link never adopts guest cookie", async () => {
  await assert.rejects(createCentralIdentityVerifier()({}), { code: "core_identity_unavailable" });
  const check = createCentralIdentityVerifier({ now: () => now, grantForRequest: async () => sealed, workspaceBinding: async () => null,
    fetchImpl: async () => ({ ok: true, json: async () => response() }) });
  await assert.rejects(check({ headers: { cookie: "ynx_code_session=guest" } }), { code: "core_workspace_binding_required" });
});
