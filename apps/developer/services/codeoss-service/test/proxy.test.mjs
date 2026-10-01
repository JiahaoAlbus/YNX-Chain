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
