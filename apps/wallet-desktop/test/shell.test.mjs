import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { StandardWalletConnection, YNX_TESTNET_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "../src/rpc.mjs";
import { WALLET_AUTH_PROTOCOL_SOURCE, YNX_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as packagedChainId } from "../src/wallet-auth-contract.mjs";

test("desktop shell consumes the authoritative Product Session v2 contract and chain", async () => {
  assert.equal(YNX_TESTNET_CHAIN_QUANTITY, "0x1917");
  assert.equal(packagedChainId, YNX_TESTNET_CHAIN_QUANTITY);
  assert.equal(YNX_EVM_CHAIN_ID, 6423);
  const source = await readFile(new URL("../src/product-session-v2.js", import.meta.resolve("@ynx-chain/wallet-auth")));
  assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.protocol, "product-session-v2");
});

test("desktop packaging exposes real platform installer formats", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.match(packageJson.scripts["dist:windows"], /--win nsis/);
  assert.match(packageJson.scripts["dist:mac"], /scripts\/build-mac\.mjs/);
  assert.deepEqual(packageJson.build.mac.target, ["dmg"]);
  assert.deepEqual(packageJson.build.win.target, ["nsis"]);
  assert.equal(packageJson.build.mac.artifactName, "ynx-wallet-macos-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.win.artifactName, "ynx-wallet-desktop-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.win.executableName, "YNX Wallet");
  assert.equal(packageJson.build.afterPack, "scripts/after-pack.mjs");
  assert.doesNotMatch(packageJson.scripts["dist:mac"], /zip/);
  assert.equal(packageJson.version, "0.6.3");
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
  const callbackGateGenerator = await readFile(new URL("../scripts/generate-callback-gate-urls.mjs", import.meta.url), "utf8");
  const x64Workflow = await readFile(new URL("../../../.github/workflows/wallet-desktop-windows.yml", import.meta.url), "utf8");
  const arm64Workflow = await readFile(new URL("../../../.github/workflows/wallet-desktop-windows-arm64.yml", import.meta.url), "utf8");
  assert.match(gate, /#create-account/);
  assert.match(gate, /window\.ynxWallet\.accountStatus\(\)/);
  assert.match(gate, /window\.ynxWallet\.walletConnectStatus\(\)/);
  assert.match(gate, /native\.custody === "os-encrypted-local"/);
  assert.match(gate, /state\.selectedAccount === account/);
  assert.match(gate, /native\.code === "WALLETCONNECT_PROJECT_ID_UNAVAILABLE"/);
  assert.match(gate, /secretDecryptionProved: false/);
  assert.doesNotMatch(gate, /Secure Testnet account ready|OS-encrypted local custody|WalletConnect not configured/);
  assert.match(callbackGateGenerator, /encodeProductSessionWalletURL/);
  assert.match(callbackGateGenerator, /createProductSessionRequest/);
  for (const workflow of [x64Workflow, arm64Workflow]) {
    assert.match(workflow, /provider-authority-ui-gate\.mjs .* create/);
    assert.match(workflow, /provider-authority-ui-gate\.mjs .* restore/);
    assert.match(workflow, /providerAuthorityAccount/);
    assert.match(workflow, /accountRestoredOnSecondLaunch = \$true/);
    assert.match(workflow, /walletConnectConfigured = \$false/);
    assert.match(workflow, /canonicalAuthorizeProtocolRegistered = \$true/);
    assert.match(workflow, /canonicalAuthorizeCallbackReceived = \$true/);
    assert.match(workflow, /callback-ui-gate\.mjs \$targets reject/);
    assert.match(workflow, /callback-ui-gate\.mjs \$targets approve/);
    assert.match(workflow, /verify-windows-callback-capture\.mjs/);
    assert.match(workflow, /canonicalAuthorizeCallbackSignatureVerified = \$true/);
    assert.match(workflow, /CloseMainWindow\(\)/);
    assert.match(workflow, /WaitForExit\(15000\)/);
    assert.doesNotMatch(workflow, /Stop-Process -Id \$(cold|second|failed)\.Id -Force/);
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
  assert.match(html, /id="provider-request"/);
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
  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /extractYNXWalletProtocolUrl\(argv\)/);
  assert.match(main, /app\.setAsDefaultProtocolClient\("ynxwallet"\)/);
  assert.match(main, /app\.isDefaultProtocolClient\("ynxwallet"\)/);
  assert.match(main, /callbackEmitted: false/);
  assert.match(main, /CANONICAL_AUTHORIZATION_SIGN_FAILED/);
  assert.match(await readFile(new URL("../src/callback-policy.mjs", import.meta.url), "utf8"), /CANONICAL_CALLBACK_LAUNCH_FAILED/);
  assert.match(main, /OS_SECRET_DECRYPT_FAILED/);
  assert.match(main, /AUTHORIZATION_TIME_INVALID/);
  assert.match(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"), /underlyingCode/);
  assert.match(main, /window\.isVisible\(\)/);
  assert.match(main, /window\.getTitle\(\)/);
});

test("security invalidation clears old unlock success while an unchanged locked refresh preserves current feedback", async () => {
  const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const start = renderer.indexOf("function renderKeyState(state) {");
  const end = renderer.indexOf("\npasswordUI = createPasswordVaultUI", start);
  assert.ok(start >= 0 && end > start);
  for (const fixture of [
    { before: { locked: false, revision: 4 }, after: { locked: true, revision: 5 }, message: "Wallet unlocked. Review each request before approving.", expected: "" },
    { before: { locked: true, revision: 5 }, after: { locked: true, revision: 6 }, message: "Wallet unlocked. Review each request before approving.", expected: "" },
    { before: { locked: true, revision: 5 }, after: { locked: true, revision: 5 }, message: "The password is incorrect or the encrypted Wallet was changed.", expected: "The password is incorrect or the encrypted Wallet was changed." }
  ]) {
    const elements = new Map();
    const document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, { textContent: "", hidden: false, disabled: false }); return elements.get(selector); }, querySelectorAll: () => [] };
    document.querySelector("#unlock-result").textContent = fixture.message;
    runInNewContext(`${renderer.slice(start, end)}\nrenderKeyState(nextState);`, {
      document, keyState: fixture.before, nextState: fixture.after, signingShort: {}, activeAccount: "qa-public-account",
      approvalQueue: { clear() {} }, authorizationChoices: new Map(), transferReview: null,
      passwordUI: { cancel() {}, render() {} }, renderKeyDetail() {}, presentApproval() {}
    });
    assert.equal(document.querySelector("#key-security-title").textContent, "Wallet locked");
    assert.equal(document.querySelector("#unlock-result").textContent, fixture.expected);
  }
});

test("private Product Session methods cannot alter the independent standard Provider connection", async () => {
  const provider = { async request({ method }) { return method === "eth_requestAccounts" ? ["0x1234567890abcdef1234567890abcdef12345678"] : "0x1917"; } };
  const client = new StandardWalletConnection({ provider, origin: "https://example.test", metadata: { name: "Standard DApp", url: "https://example.test" } });
  const connected = await client.connect();
  await assert.rejects(client.request({ method: "ynx_productSession" }), error => error.code === 4200);
  assert.equal(client.current, connected);
  assert.equal(client.current.connected, true);
  assert.equal(client.current.selectedChain, "0x1917");
  assert.equal(client.current.selectedAccount, "0x1234567890abcdef1234567890abcdef12345678");
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
