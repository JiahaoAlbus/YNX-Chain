import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../proposals/p0-wallet-connectivity/wallet-protocol/", import.meta.url);
const required = [
  "wallet-transport-contract.json", "eip1193-provider-contract.json", "eip6963-discovery-contract.json", "walletconnect-contract.json",
  "product-session-contract.json", "device-proof-contract.json", "callback-contract.json", "faucet-deeplink-contract.json", "error-contract.json", "client-retirement-contract.json",
];
const vectors = JSON.parse(readFileSync(new URL("CROSS_PLATFORM_CONNECTION_VECTORS.json", root), "utf8"));

test("P0 Wallet protocol candidate contracts remain owner-local, complete and unaccepted", () => {
  assert.deepEqual(required.filter((file) => !readdirSync(root).includes(file)), []);
  for (const file of required) {
    const proposal = JSON.parse(readFileSync(new URL(file, root), "utf8"));
    assert.equal(proposal.status, "CANDIDATE");
    assert.equal(proposal.owner, "wallet-protocol");
    assert.match(proposal.contractVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(proposal.activation, "prohibited until Integration ACCEPTED");
  }
  assert.equal(vectors.status, "CANDIDATE");
  assert.equal(vectors.assertions.standardConnectionGatewayIndependent, true);
  assert.equal(vectors.assertions.productSessionFailurePreservesStandardConnection, true);
  assert.equal(vectors.assertions.noLocalProductSession, true);
});

test("P0 enhanced error contract gives each published error a complete non-offline classification", () => {
  const contract = JSON.parse(readFileSync(new URL("error-contract.json", root), "utf8"));
  assert.equal(contract.errors.length, 26);
  for (const item of contract.errors) {
    assert.deepEqual(Object.keys(item).sort(), [...contract.schema.required].sort());
    assert.equal(typeof item.code, "string"); assert.equal(Number.isInteger(item.httpStatus), true);
    assert.equal(typeof item.retryable, "boolean"); assert.match(item.safeMessage, /\S/);
    assert.notEqual(item.diagnosticClass, "offline");
  }
});
