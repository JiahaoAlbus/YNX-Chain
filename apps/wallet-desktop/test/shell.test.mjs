import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createStandardWalletConnectState, reduceStandardWalletConnectState, YNX_TESTNET_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "../src/rpc.mjs";
import { WALLET_AUTH_PROTOCOL_SOURCE, YNX_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as packagedChainId } from "../src/wallet-auth-contract.mjs";

test("desktop shell consumes frozen Wallet Auth chain constant", () => {
  assert.equal(YNX_TESTNET_CHAIN_QUANTITY, "0x1917");
  assert.equal(packagedChainId, YNX_TESTNET_CHAIN_QUANTITY);
  assert.equal(YNX_EVM_CHAIN_ID, 6423);
  assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256, "b5f7bebaeacd7f128f5d2aaabc46dfc5dfd3a1359fe46eaecb7be28f7e91776a");
});

test("desktop packaging exposes real platform installer formats", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.match(packageJson.scripts["dist:windows"], /--win nsis/);
  assert.match(packageJson.scripts["dist:mac"], /--mac dmg/);
  assert.deepEqual(packageJson.build.mac.target, ["dmg"]);
  assert.deepEqual(packageJson.build.win.target, ["nsis"]);
  assert.equal(packageJson.build.mac.artifactName, "ynx-wallet-macos-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.win.artifactName, "ynx-wallet-desktop-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.win.executableName, "YNX Wallet");
  assert.equal(packageJson.build.afterPack, "scripts/after-pack.mjs");
  assert.doesNotMatch(packageJson.scripts["dist:mac"], /zip/);
  assert.equal(packageJson.version, "0.4.0");
  assert.equal(packageJson.build.appId, "com.ynxweb4.wallet.macos");
  assert.equal(packageJson.build.mac.minimumSystemVersion, "13.0");
  assert.deepEqual(packageJson.build.protocols[0].schemes, ["ynxwallet"]);
});

test("macOS packaging hook removes localhost transport exceptions", async () => {
  const hook = await readFile(new URL("../scripts/after-pack.mjs", import.meta.url), "utf8");
  assert.match(hook, /NSAppTransportSecurity/);
  assert.match(hook, /NSAllowsArbitraryLoads: false/);
  assert.match(hook, /NSAllowsLocalNetworking: false/);
  assert.match(hook, /CFBundleURLTypes/);
  assert.match(hook, /com\.ynxweb4\.wallet\.macos/);
  assert.match(hook, /context\.packager\.appInfo\.version/);
  assert.doesNotMatch(hook, /CFBundleShortVersionString[^\n]*0\.1\.2/);
  assert.match(hook, /LSMinimumSystemVersion/);
  assert.doesNotMatch(hook, /NSExceptionDomains/);
});

test("native Windows lifecycle drives visible provider authority and preserves missing WalletConnect fail-closed", async () => {
  const gate = await readFile(new URL("../scripts/provider-authority-ui-gate.mjs", import.meta.url), "utf8");
  const x64Workflow = await readFile(new URL("../../../.github/workflows/wallet-desktop-windows.yml", import.meta.url), "utf8");
  const arm64Workflow = await readFile(new URL("../../../.github/workflows/wallet-desktop-windows-arm64.yml", import.meta.url), "utf8");
  assert.match(gate, /#create-account/);
  assert.match(gate, /Secure Testnet account ready/);
  assert.match(gate, /WALLETCONNECT_PROJECT_ID_UNAVAILABLE/);
  for (const workflow of [x64Workflow, arm64Workflow]) {
    assert.match(workflow, /provider-authority-ui-gate\.mjs .* create/);
    assert.match(workflow, /provider-authority-ui-gate\.mjs .* restore/);
    assert.match(workflow, /providerAuthorityAccount/);
    assert.match(workflow, /accountRestoredOnSecondLaunch = \$true/);
    assert.match(workflow, /walletConnectConfigured = \$false/);
    assert.match(workflow, /Uninstall YNX Wallet\.exe/);
    assert.match(workflow, /-Filter 'YNX Wallet\.exe'/);
  }
});

test("shell is explicit and fail closed", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  const rpc = await readFile(new URL("../src/rpc.mjs", import.meta.url), "utf8");
  assert.match(html, /Create secure Testnet account/);
  assert.match(html, /WALLETCONNECT/);
  assert.match(html, /PROVIDER REQUEST/);
  assert.match(html, /Approve request/);
  assert.match(html, /Reject request/);
  assert.match(html, /Every message, typed-data and transaction request requires visible approval/);
  assert.match(rpc, /payload\?\.result !== expectedChainId/);
  assert.match(main, /CANONICAL_RPC_URL/);
  assert.doesNotMatch(main, /https:\/\/evm\.ynxweb4\.com/);
  assert.match(main, /wallet-auth-contract\.mjs/);
  assert.match(main, /appVersion: app\.getVersion\(\)/);
  assert.match(main, /externalAccountExposureRequiresOriginApproval: true/);
  assert.match(main, /walletConnect\.status\(\)\.configured/);
  assert.match(main, /app\.on\("open-url"/);
  assert.match(main, /callbackEmitted: false/);
  assert.match(main, /window\.isVisible\(\)/);
  assert.match(main, /window\.getTitle\(\)/);
});

test("shared Provider baseline keeps Standard Wallet connected when Product Session degrades", () => {
  let state = createStandardWalletConnectState();
  state = reduceStandardWalletConnectState(state, { type: "BEGIN", pendingIntent: "desktop_connect_1234567890" });
  state = reduceStandardWalletConnectState(state, { type: "PROVIDER_SELECTED", providerKind: "ynx-wallet" });
  state = reduceStandardWalletConnectState(state, { type: "ACCOUNT_APPROVED", account: "0x1234567890abcdef1234567890abcdef12345678" });
  state = reduceStandardWalletConnectState(state, { type: "CHAIN_CONFIRMED", chainId: "0x1917" });
  state = reduceStandardWalletConnectState(state, { type: "PRIVATE_SESSION_CONNECTING" });
  state = reduceStandardWalletConnectState(state, { type: "PRIVATE_SESSION_DEGRADED", code: "GATEWAY_UNAVAILABLE" });
  assert.equal(state.status, "connected");
  assert.equal(state.privateService, "degraded");
  assert.equal(state.account, "0x1234567890abcdef1234567890abcdef12345678");
});

test("RPC probe uses canonical HTTPS, proves 0x1917, and classifies failures", async () => {
  const successFetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1917" }), { status: 200 });
  assert.deepEqual(await probeYNXTestnetRPC({ expectedChainId: "0x1917", fetchImpl: successFetch }), {
    available: true,
    chainId: "0x1917",
    endpoint: CANONICAL_RPC_URL,
    errorCode: null,
    signingEnabled: false
  });
  for (const rpcUrl of ["http://rpc.ynxweb4.com/evm", "https://localhost:6420", "https://127.0.0.1:6420"]) {
    const rejected = await probeYNXTestnetRPC({ rpcUrl, expectedChainId: "0x1917", fetchImpl: successFetch });
    assert.equal(rejected.available, false);
    assert.equal(rejected.errorCode, "RPC_ENDPOINT_REJECTED");
  }
  const wrongChainFetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), { status: 200 });
  assert.equal((await probeYNXTestnetRPC({ expectedChainId: "0x1917", fetchImpl: wrongChainFetch })).errorCode, "RPC_CHAIN_MISMATCH");
  const unavailableFetch = async () => { throw new TypeError("unreachable"); };
  assert.equal((await probeYNXTestnetRPC({ expectedChainId: "0x1917", fetchImpl: unavailableFetch })).errorCode, "RPC_UNAVAILABLE");
});
