import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import { GatewayAdmissionController } from "../src/gateway-admission.js";
import { NOW } from "./fixtures.mjs";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

async function listen(host) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

function partialRequest(port) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  socket.write("POST /v1/wallet/sessions/complete HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{");
  return socket;
}

async function waitForEvent(events, code) {
  const deadline = Date.now() + 1_000;
  for (;;) {
    const event = events.find(item => item.errorCode === code);
    if (event) return event;
    if (Date.now() >= deadline) throw new Error(`Gateway event ${code} was not observed`);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function waitForOccupiedAdmission(port) {
  const deadline = Date.now() + 1_000;
  for (;;) {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (response.status === 503 && (await response.json()).error?.code === "CONCURRENCY_LIMIT") return;
    if (Date.now() >= deadline) throw new Error("Partial request did not occupy admission capacity");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

test("slow partial bodies time out without state mutation and release admission capacity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-body-timeout-"));
  const statePath = join(directory, "state.json");
  const admission = new GatewayAdmissionController({ maxConcurrent: 1, maxPerWindow: 10 });
  const events = [];
  const host = new CanonicalWalletGatewayNodeHost(approvedRegistry(), { admission, bodyTimeoutMs: 50, emitEvent: event => events.push(event), now: () => NOW, statePath });
  const before = readFileSync(statePath, "utf8");
  const { server, port } = await listen(host);
  try {
    const socket = partialRequest(port);
    await once(socket, "close");
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal((await waitForEvent(events, "REQUEST_BODY_TIMEOUT")).status, 408);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("client body abort releases admission capacity with zero state mutation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-body-abort-"));
  const statePath = join(directory, "state.json");
  const admission = new GatewayAdmissionController({ maxConcurrent: 1, maxPerWindow: 10 });
  const events = [];
  const host = new CanonicalWalletGatewayNodeHost(approvedRegistry(), { admission, bodyTimeoutMs: 5_000, emitEvent: event => events.push(event), now: () => NOW, statePath });
  const before = readFileSync(statePath, "utf8");
  const { server, port } = await listen(host);
  try {
    const socket = partialRequest(port);
    await waitForOccupiedAdmission(port);
    socket.destroy();
    await once(socket, "close");
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal((await waitForEvent(events, "REQUEST_ABORTED")).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("request body timeout policy is bounded", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-body-policy-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { bodyTimeoutMs: 9, now: () => NOW, statePath }), error => error.code === "INVALID_BODY_TIMEOUT");
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { bodyTimeoutMs: 120_001, now: () => NOW, statePath }), error => error.code === "INVALID_BODY_TIMEOUT");
});
