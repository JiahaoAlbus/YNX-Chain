#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";

const [readyPath, commit, identityMode = "canonical"] = process.argv.slice(2);
if (!readyPath || !/^[0-9a-f]{12}$/.test(commit ?? "")) throw new Error("ready path and 12-char commit are required");
if (!["canonical", "legacy-chain", "legacy-symbol"].includes(identityMode)) throw new Error("identity mode is invalid");
const fabricRelease = `ynx-data-fabric-${commit}`;
const bftRelease = `ynx-bft-gateway-${commit}`;
const chainId = identityMode === "legacy-chain" ? 9102 : 6423;
const nativeSymbol = identityMode === "legacy-symbol" ? "NYXT" : "YNXT";
const cometChainId = identityMode === "legacy-chain" ? "ynx_9102-1" : "ynx_6423-1";

const json = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {"content-type": "application/json", "content-length": body.length});
  response.end(body);
};

const fabric = http.createServer((request, response) => {
  if (request.url === "/health") {
    json(response, 200, {
      ok: true, commit, release: fabricRelease, schemaVersion: "2.0",
      databaseStatus: "verified", brokerStatus: "verified", ledgerStatus: "verified",
      integrity: "verified", degradedState: [],
      dependencyStatus: {database: {kind: "postgresql", status: "verified"}, broker: {kind: "nats", status: "verified"}},
    });
  } else if (request.url === "/version") {
    json(response, 200, {service: "ynx-data-fabric", commit, release: fabricRelease, schemaVersion: "2.0"});
  } else if (request.url === "/metrics") {
    const body = "ynx_data_fabric_events 4\nynx_data_fabric_inbox_effects 2\nynx_data_fabric_journal_entries 2\n";
    response.writeHead(200, {"content-type": "text/plain", "content-length": Buffer.byteLength(body)});
    response.end(body);
  } else {
    json(response, 404, {error: "not found"});
  }
});

const bft = http.createServer((request, response) => {
  const build = {commit, release: bftRelease};
  if (request.url === "/health") {
    json(response, 200, {ok: true, service: "ynx-bft-gatewayd", chainId, nativeSymbol, cometChainId, validatorCount: 4, build});
  } else if (request.url === "/status") {
    json(response, 200, {chainId, nativeCurrencySymbol: nativeSymbol, truthfulStatus: "cometbft-rpc-and-abci-backed", build});
  } else if (request.url === "/pay/events") {
    json(response, 200, {events: [{id: "111111111111111111111111", type: "invoice.paid"}]});
  } else {
    json(response, 404, {error: "not found"});
  }
});

await Promise.all([
  new Promise((resolve) => fabric.listen(0, "127.0.0.1", resolve)),
  new Promise((resolve) => bft.listen(0, "127.0.0.1", resolve)),
]);
const fabricPort = fabric.address().port;
const bftPort = bft.address().port;
fs.writeFileSync(readyPath, `${JSON.stringify({fabricOrigin: `http://127.0.0.1:${fabricPort}`, bftOrigin: `http://127.0.0.1:${bftPort}`})}\n`, {mode: 0o600});

const stop = () => {
  fabric.close();
  bft.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
