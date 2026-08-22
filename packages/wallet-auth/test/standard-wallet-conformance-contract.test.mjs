import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  STANDARD_WALLET_CONFORMANCE_PROFILES,
  STANDARD_WALLET_CONFORMANCE_VERSION,
  STANDARD_WALLET_EIP1193_METHODS,
} from "../src/index.js";

const contract = JSON.parse(await readFile(new URL("../../../release/integration/wallet-standard-connection-conformance-contract-p0-20260822.json", import.meta.url), "utf8"));

test("standard Wallet parity conformance binds the accepted protocol, SDK, Provider source and Central queue", () => {
  assert.equal(contract.version, STANDARD_WALLET_CONFORMANCE_VERSION);
  assert.equal(contract.authoritativeInputs.standardProtocolCommit, "66003e76e804da16d472255efde50cb879055b96");
  assert.equal(contract.authoritativeInputs.standardSdkCommit, "315897e75c0ffe3e63435fe73cfec42244b851cc");
  assert.deepEqual(contract.authoritativeInputs.sharedProvider, {
    commit: "98c6d5d784d212df8981a53b17118a511e246ad2", tree: "51a60a362d4ad5dd748bcdefb101f71b1d9e0cee", evidence: "c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",
  });
  assert.equal(contract.authoritativeInputs.centralParityQueue.commit, "f92757f7491c3e28106664aacc2066663bbd52bb");
  assert.equal(contract.authoritativeInputs.centralParityQueue.sha256, "a7448b5d6c8f6fafe7cf4611a17a10fd6c069f66be3ed80318a22ff4de76937e");
  assert.deepEqual(contract.authoritativeInputs.sharedCoreProviderSource, {
    branch: "codex/wallet-core-auth-gateway-continuation-20260814",
    implementationCommit: "d8cda9f77918cab5bdfdd0568370f3c19742c14c",
    implementationTree: "83af2d80038dd9cc7f39343efb7994ad0bb2815a",
    evidenceCommit: "0e5af17d4f784a30390452b5c2b750047e93727d",
    evidenceTree: "4f8d5006138315f26c2cc2874747cf38f31b77b2",
    evidencePath: "release/integration/wallet-standard-provider-core-source-evidence-20260822.json",
    evidenceBlob: "db781971cd557b75de9ac88bef4dad3c24599069",
    evidenceSha256: "39df6f1f38961e7253cab538bd394202c225125b214b7d128915d97599ea3697",
    historyMergedIntoRouterBranch: false,
  });
});

test("conformance contract pins Layer 1 success and preserves it during private-service degradation", () => {
  assert.deepEqual(contract.layering.successCondition, ["selected-provider", "approved-0x-account", "provider-request-eth_chainId-0x1917"]);
  assert.deepEqual(contract.layering.productSessionFailure, { standardConnection: "CONNECTED", privateService: "DEGRADED", fabricatedSession: false });
  assert.equal(contract.layering.directBrowserRpcFetchIsPrerequisite, false);
  assert.deepEqual(contract.chain, { cosmosChainId: "ynx_6423-1", evmChainId: 6423, evmChainHex: "0x1917", nativeSymbol: "YNXT", defaultLanguage: "en" });
});

test("all source profiles and explicit action methods are reflected without treating fixture coverage as external runtime", () => {
  assert.deepEqual(contract.sourceConformanceProfiles.firstParty, ["ynx-first-party"]);
  assert.deepEqual(contract.sourceConformanceProfiles.externalReferenceFixtures, ["uniswap-interface-reference", "opensea-reference", "safe-reference"]);
  assert.deepEqual(contract.sourceConformanceProfiles.transportReferenceFixtures, ["walletconnect-v2-reference"]);
  assert.deepEqual(STANDARD_WALLET_CONFORMANCE_PROFILES.map(({ id }) => id), [
    ...contract.sourceConformanceProfiles.firstParty,
    ...contract.sourceConformanceProfiles.externalReferenceFixtures,
    ...contract.sourceConformanceProfiles.transportReferenceFixtures,
  ]);
  assert.ok(STANDARD_WALLET_EIP1193_METHODS.includes("personal_sign"));
  assert.ok(STANDARD_WALLET_EIP1193_METHODS.includes("eth_signTypedData_v4"));
  assert.ok(STANDARD_WALLET_EIP1193_METHODS.includes("eth_sendTransaction"));
  assert.equal(contract.sourceConformanceProfiles.doesNotClaimExternalDappRuntime, true);
  assert.equal(contract.truth.sourceConformanceFixtureExecuted, true);
  assert.equal(contract.truth.sharedCoreSourceConsumedIntoRouterMatrix, true);
  assert.equal(contract.truth.sharedCoreRuntimeMergedIntoRouterBranch, false);
  assert.equal(contract.truth.externalDappDirectRuntimeCount, 0);
  assert.equal(contract.truth.productsConnected, 0);
});
