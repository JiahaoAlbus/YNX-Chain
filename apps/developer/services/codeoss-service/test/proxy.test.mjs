import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { createCodeOSSProxy } from "../src/proxy.mjs";

test("mounted private core HTTP forwards assets only after current owner admission and strips credentials", async t => {
  let seen, allowed = true, connections = 0;
  const kernel = createServer((req, res) => { seen = req; res.writeHead(200, { "set-cookie": "vscode-tkn=untrusted", "content-type": "text/plain" }); res.end("core asset"); });
  await new Promise(resolve => kernel.listen(0, "127.0.0.1", resolve));
  const proxy = createCodeOSSProxy({ sessionForHost: async host => host === "core.native.ynxweb4.com" ? "session" : null,
    originForSession: async () => "https://core.native.ynxweb4.com/", service: { authorizeConnection: async () => {
      if (!allowed) throw Object.assign(new Error("denied"), { status: 403 }); return { context: {}, expiresAt: Date.now() + 10000 };
    } }, driver: { connect: async () => { connections++; return { socket: connect(kernel.address().port, "127.0.0.1"), tokenMode: "private-loopback-without-connection-token" }; } } });
  const server = createServer(async (req, res) => { if (!await proxy.handler(req, res)) { res.writeHead(404); res.end(); } });
  server.on("upgrade", (req, socket, head) => proxy.handleUpgrade(req, socket, head));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { proxy.close(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => kernel.close(resolve))]); });
  const call = (host, extra = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server.address().port, path: "/asset?tkn=attacker", headers: { host, cookie: "private-wallet-cookie", authorization: "secret", "x-owner": "forged", ...extra } }, res => {
      let body = ""; res.on("data", b => { body += b; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on("error", reject); req.end();
  });
  const success = await call("core.native.ynxweb4.com"); assert.equal(success.body, "core asset"); assert.equal(success.headers["set-cookie"], undefined);
  assert.equal(seen.headers.cookie, undefined); assert.equal(seen.headers.authorization, undefined); assert.equal(seen.headers["x-owner"], undefined); assert.equal(seen.url, "/asset");
  assert.equal((await call("unknown.native.ynxweb4.com")).status, 403);
  assert.equal((await call("core.native.ynxweb4.com", { origin: "https://attacker.example" })).status, 403);
  allowed = false; assert.equal((await call("core.native.ynxweb4.com")).status, 403); assert.equal(connections, 1);
  const deniedWS = await call("core.native.ynxweb4.com", { upgrade: "websocket", connection: "upgrade", origin: "https://core.native.ynxweb4.com" });
  assert.equal(deniedWS.status, 403); assert.equal(connections, 1);
});

for (const upgrade of [false, true]) {
  test(`revocation during delayed private connect rejects ${upgrade ? "WebSocket" : "HTTP"} before forwarding bytes`, async t => {
    let allowed = true, release, reached, forwarded = 0, privateSocket;
    const connected = new Promise(resolve => { reached = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    const kernel = createServer((_req, res) => { forwarded++; res.end("private project content"); });
    kernel.on("upgrade", (_req, socket) => { forwarded++; socket.destroy(); });
    await new Promise(resolve => kernel.listen(0, "127.0.0.1", resolve));
    const proxy = createCodeOSSProxy({ sessionForHost: async () => "session", originForSession: async () => "https://core.example/",
      service: { authorizeConnection: async () => {
        if (!allowed) throw Object.assign(new Error("revoked"), { status: 403 });
        return { context: { runtimeId: "runtime-A" }, expiresAt: Date.now() + 10000 };
      } }, driver: { connect: async () => {
        reached(); await delayed;
        privateSocket = connect(kernel.address().port, "127.0.0.1");
        return { socket: privateSocket, tokenMode: "private-loopback-without-connection-token" };
      } } });
    const server = createServer((req, res) => proxy.handler(req, res));
    server.on("upgrade", (req, socket, head) => proxy.handleUpgrade(req, socket, head));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { release(); proxy.close(); server.closeAllConnections(); kernel.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => kernel.close(resolve))]); });
    const outcome = new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: server.address().port, path: "/private-file", headers: { host: "core.example", ...(upgrade ? { upgrade: "websocket", connection: "upgrade", origin: "https://core.example" } : {}) } }, res => {
        res.resume(); res.on("end", () => resolve(res.statusCode));
      }); req.on("error", reject); req.end();
    });
    await connected; allowed = false; release();
    assert.equal(await outcome, 403); assert.equal(forwarded, 0); assert.equal(privateSocket.destroyed, true);
  });
}

for (const transition of ["runtime", "project", "identity-reference", "generation", "expiry"]) {
test(`private connect rejects changed ${transition} even when fresh admission succeeds`, async t => {
  let fresh = false, calls = 0, forwarded = 0, privateSocket;
  const kernel = createServer((_req, res) => { forwarded++; res.end("private content"); });
  await new Promise(resolve => kernel.listen(0, "127.0.0.1", resolve));
  const proxy = createCodeOSSProxy({ sessionForHost: async () => "session", originForSession: async () => "https://core.example/",
    service: { authorizeConnection: async () => { calls++; return {
      context: { runtimeId: fresh && transition === "runtime" ? "runtime-B" : "runtime-A", projectId: fresh && transition === "project" ? "project-B" : "project-A" },
      identity: { identityReference: fresh && transition === "identity-reference" ? "identity-B" : "identity-A", generation: fresh && transition === "generation" ? 2 : 1 },
      expiresAt: Date.now() + (fresh && transition === "expiry" ? -1000 : 10000),
    }; } },
    driver: { connect: async () => { fresh = true; privateSocket = connect(kernel.address().port, "127.0.0.1"); return { socket: privateSocket, tokenMode: "private-loopback-without-connection-token" }; } } });
  const server = createServer((req, res) => proxy.handler(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { proxy.close(); server.closeAllConnections(); kernel.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => kernel.close(resolve))]); });
  const outcome = await new Promise((resolve, reject) => { const req = request({ hostname: "127.0.0.1", port: server.address().port, path: "/asset", headers: { host: "core.example" } }, res => { let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body })); }); req.on("error", reject); req.end(); });
  assert.equal(outcome.status, 403); assert.equal(JSON.parse(outcome.body).code, "core_identity_changed"); assert.equal(calls, 2); assert.equal(forwarded, 0); assert.equal(privateSocket.destroyed, true);
});
}
