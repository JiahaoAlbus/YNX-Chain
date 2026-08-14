import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicERC4337MetadataCandidate, WalletAuthError } from "../src/index.js";

const EP = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const PAYMASTER = "0x3333333333333333333333333333333333333333";
const SENDER = "0x4444444444444444444444444444444444444444";
const SOURCE = "1".repeat(40);

test("public metadata candidate requires deployment, monitor and sponsored receipt consensus", () => {
  const candidate = buildPublicERC4337MetadataCandidate(input());
  assert.equal(candidate.chainId, 6423);
  assert.equal(candidate.contracts.entryPoint.address, EP);
  assert.equal(candidate.contracts.factory.address, FACTORY);
  assert.equal(candidate.contracts.paymaster.address, PAYMASTER);
  assert.equal(candidate.sponsoredReceipt.sender, SENDER);
  assert.equal(candidate.eligibleForWebsitePublication, true);
  assert.equal(candidate.websitePublished, false);
  assert.equal(candidate.publicMetadataPublished, false);
  assert.equal(candidate.requiresWebsiteOwnerAcceptance, true);
  assert.equal(candidate.monitoring.continuousMonitoringDeployed, false);
  assert.equal(candidate.secretMaterialRecorded, false);
});

test("local, partial, substituted and unsuccessful evidence cannot create metadata", () => {
  const good = input();
  for (const value of [
    { ...good, deployment: { ...good.deployment, environment: "isolated-local" } },
    { ...good, deployment: { ...good.deployment, ready: false } },
    { ...good, monitor: { ...good.monitor, healthy: false } },
    { ...good, monitor: { ...good.monitor, deployment: { ...good.monitor.deployment, sourceCommit: "2".repeat(40) } } },
    { ...good, sponsoredReceipt: { ...good.sponsoredReceipt, authority: "local-fixture" } },
    { ...good, sponsoredReceipt: { ...good.sponsoredReceipt, value: { ...good.sponsoredReceipt.value, paymaster: FACTORY } } },
    { ...good, sponsoredReceipt: { ...good.sponsoredReceipt, value: { ...good.sponsoredReceipt.value, success: false } } },
    { ...good, sponsoredReceipt: { ...good.sponsoredReceipt, value: { ...good.sponsoredReceipt.value, blockNumber: "0x21" } } },
  ]) assert.throws(() => buildPublicERC4337MetadataCandidate(value), error("PUBLIC_METADATA_NOT_ELIGIBLE"));
});

test("credentialed or noncanonical explorer URLs fail before metadata creation", () => {
  for (const explorerBaseUrl of ["http://explorer.invalid/", "https://user:secret@explorer.invalid/", "https://explorer.invalid/?key=secret", "https://explorer.invalid/path"]) {
    assert.throws(() => buildPublicERC4337MetadataCandidate({ ...input(), explorerBaseUrl }), error("INVALID_CONFIG"));
  }
});

function input() { const deployment = deploymentEvidence(); return { deployment, monitor: monitorEvidence(deployment), sponsoredReceipt: sponsoredEvidence(), explorerBaseUrl: "https://explorer.ynx.invalid/" }; }
function deploymentEvidence() { return { schemaVersion: 1, verification: "wallet-auth-public-erc4337-deployment", environment: "public-testnet", sourceCommit: SOURCE, chainId: 6423, contracts: { entryPoint: contract(EP, "a1", "11", false), factory: contract(FACTORY, "b2", "22", false), paymaster: contract(PAYMASTER, "c3", "33", true) }, checks: allTrue(["rpcChainMatches","bundlerChainMatches","entryPointSupported","entryPointReceiptAndRuntime","factoryReceiptAndRuntime","paymasterReceiptAndRuntime","factoryEntryPointMatches","paymasterEntryPointMatches"]), ready: true, releaseClaims: { entryPointDeployedPublic:true, factoryDeployedPublic:true, paymasterDeployedPublic:true, bundlerDeployedPublic:true }, secretMaterialRecorded:false }; }
function contract(address, byte, hashByte, requiredEvent) { return { address, transactionHash: `0x${byte.repeat(32)}`, blockNumber: "0x10", receiptMatches:true, requiredDeploymentEventMatches:requiredEvent || address !== PAYMASTER, runtimeBytes:10, observedRuntimeSha256:hashByte.repeat(32), runtimeMatches:true, verified:true }; }
function monitorEvidence(deployment) { return { schemaVersion:1, verification:"wallet-auth-public-erc4337-monitor-sample", environment:"public-testnet", observedAt:"2026-08-14T08:00:00.000Z", deployment, block:{number:"0x20",timestamp:"2026-08-14T07:59:55.000Z",ageSeconds:5}, paymaster:{sponsorshipEnabled:true,expectedSponsorshipEnabled:true,depositWei:"100",minimumDepositWei:"1",events:[]}, checks:allTrue(["deploymentVerified","blockFresh","sponsorshipEnabledMatches","depositMeetsMinimum","paymasterEventLogQueryVerified"]), healthy:true, releaseClaims:{monitoringSampleHealthy:true,monitoringPublic:false},secretMaterialRecorded:false }; }
function sponsoredEvidence() { return { value:{actualGasCost:"0x10",actualGasUsed:"0x20",blockHash:`0x${"44".repeat(32)}`,blockNumber:"0x20",entryPoint:EP,nonce:"0x0",paymaster:PAYMASTER,sender:SENDER,success:true,transactionHash:`0x${"55".repeat(32)}`,userOperationHash:`0x${"66".repeat(32)}`},source:"https://bundler.ynx.invalid",asOf:"2026-08-14T07:59:58.000Z",version:"ERC-7769",authority:"bundler-provider-response" }; }
function allTrue(keys) { return Object.fromEntries(keys.map(key => [key, true])); }
function error(code) { return value => value instanceof WalletAuthError && value.code === code; }
