import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function load(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

const contract = load("release/integration/security-platform-contract.json");
const vectors = load("docs/integration/SECURITY_PLATFORM_CROSS_PRODUCT_TEST_VECTORS.json");
const platformStatus = load("release/security-platform/platform-status.json");
const identityPolicy = load("security-platform/service-identity-policy.json");

const nineStates = [
  "implementedLocal",
  "testedLocal",
  "installedLocal",
  "integratedCentral",
  "deployedStaging",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "storeReleased",
];

test("integration contract is bound to a full source commit and the nine-state truth model", () => {
  assert.match(contract.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(contract.sourceCommit, platformStatus.sourceCommit);
  assert.deepEqual(Object.keys(contract.releaseStatus), nineStates);
  assert.deepEqual(Object.keys(platformStatus.states), nineStates);
  assert.deepEqual(contract.releaseStatus, platformStatus.states);
});

test("true release states have evidence and false states have explicit blockers", () => {
  for (const state of nineStates) {
    if (platformStatus.states[state]) {
      assert.ok(Array.isArray(platformStatus.evidence[state]), `${state} must have evidence`);
      assert.ok(platformStatus.evidence[state].length > 0, `${state} evidence must not be empty`);
    } else {
      assert.equal(typeof platformStatus.blockedStates[state], "string", `${state} must explain its blocker`);
      assert.ok(platformStatus.blockedStates[state].length > 0, `${state} blocker must not be empty`);
    }
  }
});

test("contract evidence paths exist and stay workspace-relative", () => {
  for (const path of contract.evidence) {
    assert.ok(!path.startsWith("/"), `absolute evidence path is forbidden: ${path}`);
    assert.ok(!path.includes(".."), `parent traversal is forbidden: ${path}`);
    assert.ok(existsSync(resolve(root, path)), `evidence does not exist: ${path}`);
  }
});

test("cross-product vectors are unique and expected errors are declared by the contract", () => {
  assert.equal(vectors.sourceCommit, contract.sourceCommit);
  const ids = vectors.vectors.map((vector) => vector.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("service-identity-valid"));
  assert.ok(ids.includes("service-identity-wrong-environment"));
  assert.ok(ids.includes("service-identity-wrong-audience"));
  assert.ok(ids.includes("service-identity-replay"));
  assert.ok(ids.includes("artifact-unsigned-public"));
  assert.ok(ids.includes("backup-tamper"));
  assert.ok(ids.includes("restore-byte-mismatch"));

  for (const vector of vectors.vectors) {
    const errorCode = vector.expected?.errorCode;
    if (errorCode) assert.ok(contract.errorCodes.includes(errorCode), `${errorCode} is missing from the contract`);
  }
});

test("Service Identity policy errors are a subset of the integration contract", () => {
  for (const errorCode of identityPolicy.errorCodes) {
    assert.ok(contract.errorCodes.includes(errorCode), `${errorCode} is missing from the integration contract`);
  }
  assert.equal(identityPolicy.serviceIdentityRequired, true);
  assert.equal(identityPolicy.sharedAuthenticationFactorAllowed, false);
  assert.equal(identityPolicy.transport.mutualTlsRequired, true);
  assert.equal(identityPolicy.audit.authenticationMaterialRecorded, false);
});
