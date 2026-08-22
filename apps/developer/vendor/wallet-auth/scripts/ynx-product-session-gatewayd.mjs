#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON } from "../src/canonical.js";
import { forwardedClient, GatewayAdmissionController } from "../src/gateway-admission.js";
import { defaultProductSessionTokenFactory, ProductSessionGatewayNodeHost, PRODUCT_SESSION_GATEWAY_NODE_SERVICE } from "../src/product-session-gateway-node-host.js";

const address = process.env.YNX_PRODUCT_SESSION_GATEWAY_HTTP_ADDR ?? "127.0.0.1";
const port = integer(process.env.YNX_PRODUCT_SESSION_GATEWAY_HTTP_PORT ?? "6441", "YNX_PRODUCT_SESSION_GATEWAY_HTTP_PORT", 1, 65535);
const statePath = process.env.YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH;
const remoteDeployed = boolean(process.env.YNX_PRODUCT_SESSION_GATEWAY_REMOTE_DEPLOYED ?? "false", "YNX_PRODUCT_SESSION_GATEWAY_REMOTE_DEPLOYED");
const build = buildIdentity(process.env);
const registryPath = process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH ? resolve(process.env.YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH) : fileURLToPath(new URL("../product-session-registry.json", import.meta.url));
if (address !== "127.0.0.1" && address !== "::1" && address !== "localhost" && !(isIP(address) && address.startsWith("127."))) throw new Error("YNX_PRODUCT_SESSION_GATEWAY_HTTP_ADDR must be loopback");
if (!statePath) throw new Error("YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH is required");
if (remoteDeployed && !build) throw new Error("remote deployment requires exact Product Session Gateway build identity");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const emitEvent = (event) => process.stdout.write(`${canonicalJSON(event)}\n`);
const host = new ProductSessionGatewayNodeHost(registry, { emitEvent, now: () => new Date(), statePath, tokenFactory: defaultProductSessionTokenFactory }, build ? { build, remoteDeployed } : { remoteDeployed });
const admission = new GatewayAdmissionController({ maxConcurrent: integer(process.env.YNX_PRODUCT_SESSION_GATEWAY_MAX_CONCURRENT ?? "128", "YNX_PRODUCT_SESSION_GATEWAY_MAX_CONCURRENT", 1, 1024), maxPerWindow: integer(process.env.YNX_PRODUCT_SESSION_GATEWAY_RATE_LIMIT ?? "600", "YNX_PRODUCT_SESSION_GATEWAY_RATE_LIMIT", 1, 100000) });
const gatewayHandler = host.handler();
const server = createServer((request, response) => {
  const ticket = admission.enter(forwardedClient(request));
  if (!ticket.ok) {
    response.writeHead(ticket.status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "retry-after": "60", "x-content-type-options": "nosniff" });
    response.end(canonicalJSON({ error: { code: ticket.code, message: "Product Session Gateway admission policy rejected the request" }, ok: false, schemaVersion: 2 }));
    return;
  }
  response.once("finish", ticket.release);
  response.once("close", ticket.release);
  Promise.resolve(gatewayHandler(request, response)).catch(() => {
    ticket.release();
    if (!response.headersSent) {
      response.writeHead(500, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
      response.end(canonicalJSON({ error: { code: "HOST_FAILURE", message: "Product Session Gateway request failed closed" }, ok: false, schemaVersion: 2 }));
    }
  });
});
server.listen(port, address, () => emitEvent({ at: new Date().toISOString(), build: build ?? { buildTime: null, release: "local-unbound", sourceCommit: null }, event: "listening", level: "info", remoteDeployed, service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE, url: `http://${address}:${port}` }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => host.waitForIdle().then(() => { emitEvent({ at: new Date().toISOString(), event: "shutdown", level: "info", service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE, signal }); process.exit(0); })));

function integer(value, label, minimum, maximum) { if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be an integer`); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} is outside policy`); return parsed; }
function boolean(value, label) { if (value === "true") return true; if (value === "false") return false; throw new Error(`${label} must be true or false`); }
function buildIdentity(env) {
  const values = [env.YNX_PRODUCT_SESSION_GATEWAY_SOURCE_COMMIT, env.YNX_PRODUCT_SESSION_GATEWAY_RELEASE, env.YNX_PRODUCT_SESSION_GATEWAY_BUILD_TIME];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => value === undefined)) throw new Error("Product Session Gateway build identity variables must be supplied together");
  const [sourceCommit, release, buildTime] = values;
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("YNX_PRODUCT_SESSION_GATEWAY_SOURCE_COMMIT must be a full lowercase Git SHA");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(release)) throw new Error("YNX_PRODUCT_SESSION_GATEWAY_RELEASE is invalid");
  if (!Number.isFinite(Date.parse(buildTime)) || new Date(buildTime).toISOString() !== buildTime) throw new Error("YNX_PRODUCT_SESSION_GATEWAY_BUILD_TIME must be canonical ISO-8601 UTC");
  return { buildTime, release, sourceCommit };
}
