import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeveloperSSO } from "../src/developer-sso.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";

test("failed browser editor entry offers a safe recovery page; API callers retain structured failure", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-core-entry-failure-")), store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  let status = 503;
  const service = await createDeveloperSSO({ filename: join(root, "identity.sqlite"), keyPath: join(root, "identity.key"), workspaceStore: store,
    coreSessionInfo: async () => { throw Object.assign(new Error("private-operator-detail"), { status, code: "core_not_running" }); } });
  const server = createServer((req, res) => service.handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); service.close(); store.close(); await rm(root, { recursive: true }); });
  const call = accept => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server.address().port, path: "/sso/core-open?sessionId=01234567-1234-4321-8765-0123456789ab",
      headers: { host: "developer.ynxweb4.com", accept } }, res => { let body = ""; res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); });
    req.on("error", reject); req.end();
  });
  const unavailable = await call("text/html");
  assert.equal(unavailable.status, 503); assert.match(unavailable.headers["content-type"], /text\/html/);
  assert.match(unavailable.body, /Your saved projects are preserved/); assert.match(unavailable.body, /https:\/\/developer\.ynxweb4\.com\//);
  assert.equal(unavailable.body.includes("private-operator-detail"), false); assert.equal(unavailable.headers["set-cookie"], undefined);
  assert.match(unavailable.headers["content-security-policy"], /frame-ancestors 'none'/);
  status = 401;
  const expired = await call("text/html"); assert.equal(expired.status, 401); assert.match(expired.body, /Sign in with YNX Wallet/);
  const api = await call("application/json"); assert.equal(api.status, 401); assert.equal(JSON.parse(api.body).code, "core_not_running");
});
