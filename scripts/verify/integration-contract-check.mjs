#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = (message) => {
  throw new Error(`integration-contract-check: ${message}`);
};
const requireValue = (condition, message) => {
  if (!condition) fail(message);
};
const requireRoute = (source, route) => {
  requireValue(source.includes(`HandleFunc(\"${route}\"`), `runtime route missing: ${route}`);
};
const rejectInternalStrings = (value, path = "root") => {
  if (typeof value === "string") {
    requireValue(!value.includes("/Users/"), `${path} leaks a local user path`);
    requireValue(!value.includes("Worktree"), `${path} leaks an internal workspace term`);
    requireValue(!value.includes("codex/"), `${path} leaks an internal branch`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectInternalStrings(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => rejectInternalStrings(entry, `${path}.${key}`));
  }
};

const release = readJSON("release/product-release.json");
const contract = readJSON("release/integration/chain-core-contract.json");
const vectors = readJSON("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
const metadata = readJSON("chain-metadata/ynx-testnet.json");
const stateSource = readFileSync("internal/consensus/state.go", "utf8");
const applicationSource = readFileSync("internal/consensus/application.go", "utf8");
const snapshotSource = readFileSync("internal/consensus/snapshot.go", "utf8");
const gatewaySource = readFileSync("internal/bftgateway/gateway.go", "utf8");
const evmSource = readFileSync("internal/bftgateway/evm.go", "utf8");

requireValue(release.schema === "ynx-product-release/v1", "unexpected product release schema");
requireValue(contract.schema === "ynx-integration-contract/v1", "unexpected contract schema");
requireValue(vectors.schema === "ynx-cross-product-test-vectors/v1", "unexpected vector schema");
requireValue(release.source.implementationCommit === contract.sourceCommit, "release and contract source commits differ");
requireValue(release.source.contractVersion === contract.contractVersion, "release and contract versions differ");
requireValue(contract.sourceCommit === vectors.sourceCommit, "contract and vectors source commits differ");
requireValue(/^[0-9a-f]{12}$/.test(contract.sourceCommit), "source commit must be a 12-character Git identifier");
execFileSync("git", ["merge-base", "--is-ancestor", contract.sourceCommit, "HEAD"], { stdio: "ignore" });

requireValue(metadata.chainId === 6423, "metadata EVM chain ID drift");
requireValue(metadata.nativeCurrency?.symbol === "YNXT", "metadata native asset drift");
requireValue(contract.networkIdentity.cosmosChainId === "ynx_6423-1", "Cosmos chain ID drift");
requireValue(contract.networkIdentity.evmChainIdDecimal === metadata.chainId, "contract and metadata EVM chain ID differ");
requireValue(contract.networkIdentity.evmChainIdHex === "0x1917", "hex EVM chain ID drift");
requireValue(contract.networkIdentity.nativeAsset === metadata.nativeCurrency.symbol, "contract and metadata native asset differ");
requireValue(stateSource.includes("const CommittedStateVersion = 11"), "runtime committed-state version drift");
requireValue(stateSource.includes('calculateHashFor("YNX_ABCI_STATE_V11", CommittedStateVersion)'), "runtime AppHash domain drift");
requireValue(applicationSource.includes("ApplicationVersion   = 14"), "runtime ABCI application version drift");
for (const method of ["ListSnapshots", "OfferSnapshot", "LoadSnapshotChunk", "ApplySnapshotChunk"]) {
  requireValue(snapshotSource.includes(`func (a *Application) ${method}`), `runtime state sync method missing: ${method}`);
}
requireValue(snapshotSource.includes("stateSyncSnapshotMaxBytes         = 64 << 20"), "runtime state sync size bound drift");
requireValue(contract.stateSchema.committedStateVersion === 11, "contract committed-state version drift");
requireValue(contract.stateSchema.applicationVersion === 14, "contract ABCI application version drift");
requireValue(contract.stateSchema.appHashDomain === "YNX_ABCI_STATE_V11", "contract AppHash domain drift");
requireValue(contract.stateSchema.stateSyncSnapshotFormat === 1, "contract state sync format drift");
requireValue(contract.stateSchema.stateSyncSnapshotMaxBytes === 67108864, "contract state sync size bound drift");
requireValue(contract.recovery.abciStateSync.implementedLocal === true && contract.recovery.abciStateSync.testedLocal === true, "state sync recovery status drift");
requireValue(contract.recovery.abciStateSync.trustedAppHashRequired === true && contract.recovery.abciStateSync.atomicPersistence === true, "state sync safety boundary drift");
requireValue(contract.recovery.validatorBackupRestoreRollback.remoteDrillComplete === false, "local recovery evidence cannot claim a remote drill");

for (const route of [...contract.routeClasses.publicRead, ...contract.routeClasses.signedMutation, ...contract.routeClasses.evmCompatibility]) {
  requireRoute(gatewaySource, route);
}
requireValue(contract.contractVersion === "1.2.0", "unexpected Chain Core contract version");
requireValue(contract.evmRpc.committedOnly === true, "EVM RPC must remain committed-state only");
requireValue(contract.evmRpc.historicalAccountState === false, "EVM RPC cannot claim historical account state");
requireValue(contract.evmRpc.historicalContractState === false, "EVM RPC cannot claim historical contract state");
requireValue(contract.evmRpc.pendingBlockAvailable === false, "EVM RPC cannot claim a pending block");
requireValue(contract.evmRpc.boundedContractRuntimeMode === "pinned-artifact-bounded-evm-subset", "bounded EVM runtime mode drift");
requireValue(contract.evmRpc.boundedCallNonZeroValue === false, "bounded EVM call cannot claim non-zero value support");
requireValue(contract.evmRpc.boundedCallStateOverrides === false, "bounded EVM call cannot claim state override support");
for (const method of contract.evmRpc.methods) {
  requireValue(gatewaySource.includes(`case \"${method}\"`) || gatewaySource.includes(`\"${method}\"`), `runtime EVM method missing: ${method}`);
}
for (const implementation of ["evmSendRawTransaction", "evmCommittedBlockResult", "evmCommittedAccountResult", "evmCommittedContractCode", "evmCommittedContractCall", "evmCommittedResult"]) {
  requireValue(evmSource.includes(`func (g *Gateway) ${implementation}`), `runtime EVM implementation missing: ${implementation}`);
}

const statusKeys = [
  "implementedLocal",
  "testedLocal",
  "installedLocal",
  "integratedCentral",
  "deployedStaging",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "storeReleased"
];
for (const key of statusKeys) {
  requireValue(typeof release.releaseStatus[key] === "boolean", `release status ${key} must be boolean`);
  requireValue(release.releaseStatus[key] === contract.releaseStatus[key], `release status ${key} differs from contract`);
}
requireValue(release.releaseStatus.deployedPublic === false, "current source cannot claim public deployment");
requireValue(release.deployedBaseline.publicFourValidatorBft === false, "deployed baseline cannot claim public BFT");
requireValue(release.deployedBaseline.matchesCurrentSource === false, "deployed baseline cannot claim current-source equality");
requireValue(contract.authBoundary.state === "dependency-not-accepted", "Wallet/Auth boundary must remain explicit until accepted");
requireValue(contract.authBoundary.failClosed === true, "Wallet/Auth dependency must fail closed");
requireValue(contract.authBoundary.parallelAuthProtocolAllowed === false, "parallel authentication protocol must remain forbidden");

const ids = new Set();
for (const vector of vectors.vectors) {
  requireValue(typeof vector.id === "string" && vector.id.length > 0, "vector ID missing");
  requireValue(!ids.has(vector.id), `duplicate vector ID: ${vector.id}`);
  ids.add(vector.id);
  requireValue(vector.expected === "accept" || vector.expected === "reject", `invalid expected result for ${vector.id}`);
  if (vector.expected === "reject") {
    requireValue(typeof vector.errorClass === "string" && vector.errorClass.length > 0, `negative vector lacks errorClass: ${vector.id}`);
  }
}
for (const required of [
  "native-transfer-valid-accept",
  "native-transfer-replay-reject",
  "evm-committed-block-evidence-accept",
  "evm-current-account-state-accept",
  "evm-historical-account-state-reject",
  "evm-signed-ynxt-broadcast-accept",
  "evm-signed-ynxt-replay-reject",
  "evm-bounded-contract-code-call-accept",
  "evm-bounded-contract-historical-state-reject",
  "evm-bounded-contract-value-or-state-override-reject",
  "wallet-product-session-wrong-product-reject",
  "wallet-product-session-scope-widening-reject",
  "user-operation-sponsored-batch-accept",
  "strategy-mandate-revoked-action-reject",
  "strategy-vault-engine-withdraw-reject",
  "staking-withdraw-before-maturity-reject",
  "solvency-liability-proof-tamper-reject",
  "abci-state-sync-roundtrip-accept",
  "abci-state-sync-tampered-chunk-reject",
  "validator-backup-rollback-replay-accept"
]) {
  requireValue(ids.has(required), `required cross-product vector missing: ${required}`);
}

rejectInternalStrings(release, "release");
rejectInternalStrings(contract, "contract");
rejectInternalStrings(vectors, "vectors");

console.log(`integration contract check passed: ${ids.size} vectors, state v11, source ${contract.sourceCommit}`);
