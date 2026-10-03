import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createWalletReadinessService } from "../src/service.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) {
  const deadline = Date.now() + 1000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check());
}
async function fixture(t, upstreamHandler) {
  const upstream = createServer(upstreamHandler);
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const service = createWalletReadinessService({ ownerForRequest: () => "wallet-owner",
    gatewayURL: `http://127.0.0.1:${upstream.address().port}` });
  const server = createServer((request, response) => { void service.handler(request, response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  });
  return { service, url: `http://127.0.0.1:${server.address().port}/runtime/wallet/readiness` };
}

test("Wallet readiness deadline includes stalled response headers", async t => {
  let closed = 0;
  const f = await fixture(t, (_request, response) => { response.on("close", () => { closed++; }); });
  const started = Date.now(), result = await fetch(f.url);
  assert.equal(result.status, 503); assert.equal((await result.json()).code, "wallet_gateway_unreachable");
  assert.ok(Date.now() - started < 4500); assert.equal(f.service.status().active, 0);
  await until(() => closed === 3);
});

test("Wallet readiness deadline includes a body stalled after headers and cancels all readers", async t => {
  let closed = 0;
  const f = await fixture(t, (_request, response) => {
    response.on("close", () => { closed++; });
    response.writeHead(200, { "content-type": "application/json" }); response.write('{"ok":');
  });
  const started = Date.now(), result = await fetch(f.url);
  assert.equal(result.status, 503); assert.equal((await result.json()).gateway.reachable, false);
  assert.ok(Date.now() - started < 4500); assert.equal(f.service.status().active, 0);
  await until(() => closed === 3);
});

test("Wallet readiness stops chunked bodies at 64 KiB before their end", async t => {
  let closed = 0;
  const f = await fixture(t, (_request, response) => {
    response.on("close", () => { closed++; });
    response.writeHead(200, { "content-type": "application/json" }); response.write("x".repeat(65_537));
  });
  const result = await fetch(f.url);
  assert.equal(result.status, 502); assert.equal((await result.json()).code, "wallet_response_too_large");
  assert.equal(f.service.status().active, 0); await until(() => closed === 3);
});

test("Wallet readiness cancels declared oversized responses without awaiting their body", async t => {
  let closed = 0;
  const f = await fixture(t, (_request, response) => {
    response.on("close", () => { closed++; });
    response.writeHead(200, { "content-type": "application/json", "content-length": "65537" }); response.flushHeaders();
  });
  const result = await fetch(f.url);
  assert.equal(result.status, 502); assert.equal((await result.json()).code, "wallet_response_too_large");
  assert.equal(f.service.status().active, 0); await until(() => closed === 3);
});

test("client disconnect cancels Wallet readiness readers and releases the owner slot", async t => {
  let seen = 0, closed = 0; const entered = deferred();
  const f = await fixture(t, (_request, response) => {
    response.on("close", () => { closed++; });
    response.writeHead(200, { "content-type": "application/json" }); response.write('{"ok":');
    if (++seen === 3) entered.resolve();
  });
  const controller = new AbortController(), pending = fetch(f.url, { signal: controller.signal });
  const rejected = assert.rejects(pending); await entered.promise; controller.abort(); await rejected;
  await until(() => f.service.status().active === 0 && closed === 3);
});

test("an exact 64 KiB JSON response remains accepted", async t => {
  const body = JSON.stringify({ ok: true, pad: "x".repeat(65_516) });
  assert.equal(Buffer.byteLength(body), 65_536);
  const f = await fixture(t, (_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(body); });
  assert.equal((await fetch(f.url)).status, 200); assert.equal(f.service.status().active, 0);
});

test("the body deadline also settles injected readers that ignore fetch cancellation", async t => {
  let cancellations = 0;
  const service = createWalletReadinessService({ ownerForRequest: () => "wallet-owner", fetcher: async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() { cancellations++; },
  })) });
  const server = createServer((request, response) => { void service.handler(request, response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await fetch(`http://127.0.0.1:${server.address().port}/runtime/wallet/readiness`);
  assert.equal(result.status, 503); assert.equal(service.status().active, 0); assert.equal(cancellations, 3);
});
