import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as rawRequest } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDeveloperSSO } from "../src/developer-sso.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { CENTRAL_IDENTITY } from "../src/central-identity.mjs";

test("actual consumer HTTP PKCE callback seals grants, binds stable owner, explicitly copies guest, and exchanges one-use isolated cookie", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-sso-test-")), store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  const guest = "a".repeat(64), source = { name: "Original", files: { "main.js": "console.log(42)" }, folders: [], open: ["main.js"], active: "main.js" };
  store.put(guest, "project", { expectedRevision: 0, idempotencyKey: "guest-original", payload: source });
  const grant = "private-grant-never-in-browser".repeat(3), identity = { subject: "nativeynx:alice", account: "ynx1alice", generation: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  let tokenInput, revoked = false, authorityFailure = 0, stoppedOwners = [];
  const service = await createDeveloperSSO({ filename: join(root, "identity.sqlite"), keyPath: join(root, "identity.key"), workspaceStore: store,
    guestOwnerForRequest: () => guest, coreSessionInfo: async () => ({ origin: "https://core.native.ynxweb4.com", expiresAt: Date.now() + 3600000 }),
    onSignOut: async owner => { stoppedOwners.push(owner); },
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.origin, undefined); assert.equal(options.headers.cookie, undefined); assert.equal(options.headers["sec-fetch-site"], undefined);
      const input = JSON.parse(options.body); assert.deepEqual(Object.keys(input), Object.keys(input).sort());
      if (authorityFailure) return { ok: false, status: authorityFailure, json: async () => ({ error: "unavailable" }) };
      if (url.endsWith("/token")) { tokenInput = input; assert.equal(input.clientId, CENTRAL_IDENTITY.clientId); assert.equal(input.redirectUri, CENTRAL_IDENTITY.callback); }
      if (url.endsWith("/logout-grant")) { revoked = true; return { ok: true, status: 200, json: async () => ({ revoked: true }) }; }
      return { ok: !revoked, status: revoked ? 401 : 200, json: async () => ({ identity, grantToken: grant, expiresAt: identity.expiresAt, audience: CENTRAL_IDENTITY.audience, scopes: ["identity:read"] }) };
    } });
  const server = createServer((req, res) => service.handler(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); service.close(); store.close(); });
  const call = (path, { cookie, method = "GET", body, host = "developer.ynxweb4.com", origin, contentType = "application/json" } = {}) => new Promise((resolve, reject) => {
    const req = rawRequest({ hostname: "127.0.0.1", port: server.address().port, path, method, headers: { host, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body ? { "content-type": contentType } : {}) } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }); req.on("error", reject); req.end(body);
  });
  const start = await call("/sso/start"); assert.equal(start.status, 303);
  const authorize = new URL(start.headers.location), transaction = start.headers["set-cookie"][0].split(";")[0];
  assert.equal(authorize.searchParams.get("codeChallengeMethod"), "S256"); assert.equal(authorize.searchParams.get("clientId"), CENTRAL_IDENTITY.clientId);
  const callback = `/sso/callback?code=${"c".repeat(43)}&state=${authorize.searchParams.get("state")}`;
  const signedIn = await call(callback, { cookie: transaction }); assert.equal(signedIn.status, 303);
  assert.match(tokenInput.codeVerifier, /^[A-Za-z0-9_-]{43}$/); assert.equal(tokenInput.state, authorize.searchParams.get("state"));
  assert.equal((await call(callback, { cookie: transaction })).status, 401); // one-use PKCE state
  const sessionCookie = signedIn.headers["set-cookie"][0].split(";")[0]; assert.equal(signedIn.text.includes(grant), false);
  const current = await call("/runtime/identity", { cookie: sessionCookie }); assert.equal(current.status, 200); assert.equal(JSON.parse(current.text).account, identity.account); assert.equal(current.text.includes(grant), false);
  const verified = await service.verifyIdentity({ headers: { host: "developer.ynxweb4.com", cookie: sessionCookie } });
  assert.equal(store.get(verified.workspaceOwner, "project"), null); // no automatic guest adoption
  const copyBody = JSON.stringify({ projectId: "project", expectedGuestRevision: 1, approval: "copy-guest-project-once", approvalId: "12345678-1234-1234-1234-123456789012" });
  assert.equal((await call("/runtime/identity/import", { cookie: sessionCookie, method: "POST", body: copyBody, origin: "https://attacker.example" })).status, 403);
  assert.equal((await call("/runtime/identity/import", { cookie: sessionCookie, method: "POST", body: copyBody, origin: "https://developer.ynxweb4.com" })).status, 201);
  assert.deepEqual(store.get(guest, "project").files, source.files); assert.deepEqual(store.get(verified.workspaceOwner, "project").files, source.files);
  const opened = await call("/sso/core-open?sessionId=12345678-1234-1234-1234-123456789012", { cookie: sessionCookie }); assert.equal(opened.status, 200); assert.equal(opened.text.includes(grant), false);
  const ticket = opened.text.match(/name="ticket" value="([^"]+)"/)[1];
  const admitted = await call("/sso/core-admit", { method: "POST", host: "core.native.ynxweb4.com", origin: "https://developer.ynxweb4.com", contentType: "application/x-www-form-urlencoded", body: `ticket=${ticket}` }); assert.equal(admitted.status, 303); assert.equal(admitted.headers.location, "/");
  assert.equal((await call("/sso/core-admit", { method: "POST", host: "core.native.ynxweb4.com", origin: "https://developer.ynxweb4.com", contentType: "application/x-www-form-urlencoded", body: `ticket=${ticket}` })).status, 401);
  const nativeCookie = admitted.headers["set-cookie"][0].split(";")[0];
  const nativeIdentity = await service.verifyIdentity({ headers: { host: "core.native.ynxweb4.com", cookie: nativeCookie } }); assert.equal(nativeIdentity.allowedCoreSession, "12345678-1234-1234-1234-123456789012");
  assert.equal(nativeIdentity.identityReference, verified.identityReference);
  assert.equal((await service.verifyIdentity.resolveReference(verified.identityReference)).owner, verified.owner);
  await assert.rejects(service.verifyIdentity({ headers: { host: "other.native.ynxweb4.com", cookie: nativeCookie } }), { code: "core_identity_required" });
  assert.equal((await call("/runtime/identity/logout", { cookie: sessionCookie, method: "POST", origin: "https://developer.ynxweb4.com" })).status, 200);
  await assert.rejects(service.verifyIdentity({ headers: { host: "core.native.ynxweb4.com", cookie: nativeCookie } }), { code: "core_identity_required" });
  await assert.rejects(service.verifyIdentity.resolveReference(verified.identityReference), { code: "core_identity_required" });
  for (const status of [401, 503]) {
    revoked = false; authorityFailure = 0;
    const begin = await call("/sso/start"), auth = new URL(begin.headers.location);
    const cookie = begin.headers["set-cookie"][0].split(";")[0];
    const login = await call(`/sso/callback?state=${auth.searchParams.get("state")}&code=another-code`, { cookie });
    assert.equal(login.status, 303); const signedCookie = login.headers["set-cookie"][0].split(";")[0];
    authorityFailure = status;
    const exit = await call("/runtime/identity/logout", { cookie: signedCookie, method: "POST", origin: "https://developer.ynxweb4.com" });
    assert.equal(exit.status, 200); assert.equal(JSON.parse(exit.text).signedOut, true); assert.equal(JSON.parse(exit.text).centralRevoked, false);
    assert.match(exit.headers["set-cookie"][0], /Max-Age=0/);
    await assert.rejects(service.verifyIdentity({ headers: { host: "developer.ynxweb4.com", cookie: signedCookie } }), { code: "core_identity_required" });
    assert.equal(stoppedOwners.at(-1), verified.owner);
  }
  assert.equal((await readFile(join(root, "identity.sqlite"))).includes(Buffer.from(grant)), false); // sealed at rest
});
