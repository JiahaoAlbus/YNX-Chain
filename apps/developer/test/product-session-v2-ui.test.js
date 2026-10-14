import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

// TEST_ONLY: execute the actual compiled component handlers with hook/API
// fixtures. This does not qualify a native device, session or desktop App.
async function nativePanelFixture(begin) {
  const ts = createRequire(import.meta.url)("../services/language-service/node_modules/typescript/lib/typescript.js");
  const effects = [], cleanup = [], calls = [], state = [];
  let walletReturn;
  const hooks = { useState: value => [value, next => state.push(next)], useMemo: fn => fn(), useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) };
  const jsx = (type, props) => ({ type, props });
  const transport = { desktopWalletBridge: () => ({ kind: "TEST_ONLY_NATIVE" }), subscribeDeveloperWalletCallbacks: fn => { walletReturn = fn; return () => calls.push("unsubscribe"); }, subscribeDeveloperDeploymentCallbacks: () => () => {}, openDeveloperWalletReview: async () => { calls.push("legacy-open"); return { expiresAt: "2030-01-01T00:00:00Z" }; }, createDeveloperWalletCompletion: async () => { calls.push("legacy-complete"); return { body: "fixture" }; }, saveDeveloperWalletSession: async () => calls.push("legacy-save") };
  const runtime = { loadChainStatus: async () => ({}), loadChainCompiler: async () => ({}), loadWalletReadiness: async () => ({}), loadRuntimeBuildIdentity: async () => ({}), completeDeveloperWalletSession: async () => ({ account: "TEST_ONLY", expiresAt: "2030-01-01T00:00:00Z" }) };
  const modules = { react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "../components/ui/button": { Button: "button" }, "../runtime/client": runtime, "../wallet/transport": transport, "../wallet/product-session-v2": { beginDeveloperWalletV2Connection: async () => { calls.push("explicit-begin"); return begin(); }, inspectDeveloperWalletV2Runtime: async () => ({ available: true }), enterDeveloperWalletV2Guest: async () => ({ available: true, sessionState: { message: "Guest", limitations: ["no-chain-authority"] } }) }, "../wallet/safe-authorize-launcher": {}, "../wallet/WalletIdentityMark": { WalletIdentityMark: "identity" }, "../dapp/StandardWalletDappCompatibilityLab": { StandardWalletDappCompatibilityLab: "lab" } };
  const source = await read("frontend/src/chain/ChainPanel.tsx");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert.ok(modules[id], `unexpected import ${id}`); return modules[id]; }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, Date, Promise, Error });
  const tree = exports.ChainPanel({ files: {}, onAddFile() {} });
  for (const effect of effects) { const end = effect(); if (end) cleanup.push(end); }
  const button = label => { let found; const walk = node => { if (!node || typeof node !== "object") return; const children = node.props?.children; if (node.type === "button" && children === label) found = node; for (const child of Array.isArray(children) ? children : [children]) walk(child); }; walk(tree); assert.ok(found, label); return found; };
  return { calls, state, button, callback: url => walletReturn(url), unmount: () => cleanup.forEach(fn => fn()) };
}

test("explicit Native Sign in uses the current SDK factory without requiring compiled bytecode", async () => {
  const calls = []; let finish;
  const runtime = { finished: new Promise(resolve => finish = resolve), connection: { beginYNX: async () => { calls.push("beginYNX"); return { status: "wallet-opened" }; } }, endNativeOperation: async () => { calls.push("end"); finish(); } };
  const f = await nativePanelFixture(() => runtime);
  try { const button = f.button("Sign in with YNX Wallet"); assert.equal(button.props.disabled, false); await button.props.onClick(); assert.deepEqual(f.calls.filter(x => /begin|legacy/.test(x)), ["explicit-begin"]); assert.deepEqual(calls, ["beginYNX"]); }
  finally { f.unmount(); }
});

test("unowned Wallet return never runs legacy completion or creates a runtime", async () => {
  const f = await nativePanelFixture(() => { throw Error("must not begin passively"); });
  try { await f.callback("ynxdeveloper://wallet-auth/callback?TEST_ONLY"); assert.deepEqual(f.calls.filter(x => /begin|legacy/.test(x)), []); }
  finally { f.unmount(); }
});

test("active Wallet return is routed once and a late opener cannot replace its result", async () => {
  let openReply, returnReply, finish; const calls = [];
  const runtime = { finished: new Promise(resolve => finish = resolve), connection: { beginYNX: () => new Promise((_, reject) => openReply = reject), handleReturn: url => { calls.push(url); return new Promise(resolve => returnReply = resolve); } }, endNativeOperation: async () => finish() };
  const f = await nativePanelFixture(() => runtime);
  try { const opening = f.button("Sign in with YNX Wallet").props.onClick(); while (!openReply) await new Promise(r => setImmediate(r));
    const url = "ynxdeveloper://wallet-auth/callback?TEST_ONLY"; const returning = f.callback(url); await new Promise(r => setImmediate(r)); await f.callback(url); assert.deepEqual(calls, [url]);
    returnReply({ status: "session-state", sessionState: { status: "connected" } }); await returning;
    openReply(Error("late opener failure")); await opening; assert.equal(f.state.includes("late opener failure"), false); assert.ok(f.state.includes("Wallet Product Session: connected.")); assert.equal(f.calls.some(x => x.startsWith("legacy")), false);
  } finally { f.unmount(); }
});

test("unmount before native consent returns closes that runtime without opening Wallet", async () => {
  let factoryReply; const calls = [];
  const runtime = { finished: new Promise(() => {}), connection: { beginYNX: async () => calls.push("begin") }, endNativeOperation: async () => calls.push("end") };
  const f = await nativePanelFixture(() => new Promise(resolve => factoryReply = resolve)); const opening = f.button("Sign in with YNX Wallet").props.onClick();
  while (!factoryReply) await new Promise(r => setImmediate(r)); f.unmount(); factoryReply(runtime); await opening; assert.deepEqual(calls, ["end"]);
});

test("Guest invalidates the active native attempt and ignores its later return", async () => {
  let finish; const calls = [];
  const runtime = { finished: new Promise(resolve => finish = resolve), connection: { beginYNX: async () => ({ status: "wallet-opened" }), handleReturn: async () => calls.push("return") }, endNativeOperation: async () => { calls.push("end"); finish(); } };
  const f = await nativePanelFixture(() => runtime);
  try { await f.button("Sign in with YNX Wallet").props.onClick(); await f.button("Continue as Guest / Try mode").props.onClick(); await f.callback("stale"); assert.deepEqual(calls, ["end"]); assert.equal(f.calls.some(x => x.startsWith("legacy")), false); }
  finally { f.unmount(); }
});

test("a Native cleanup failure remains visible without blocking unsigned Guest development", async () => {
  const runtime = { finished: new Promise(() => {}), connection: { beginYNX: async () => ({ status: "wallet-opened" }) }, endNativeOperation: async () => { throw Error("original cleanup failure"); } };
  const f = await nativePanelFixture(() => runtime);
  try { await f.button("Sign in with YNX Wallet").props.onClick(); await f.button("Continue as Guest / Try mode").props.onClick(); assert.ok(f.state.includes("original cleanup failure")); assert.ok(f.state.some(x => typeof x === "string" && x.startsWith("Guest Limits:"))); }
  finally { f.unmount(); }
});

test("actual native completion releases the UI attempt so explicit Sign in can retry", async () => {
  let finish; let begins = 0;
  const make = () => { begins++; return { finished: new Promise(resolve => finish = resolve), connection: { beginYNX: async () => ({ status: "wallet-opened" }) }, endNativeOperation: async () => finish() }; };
  const f = await nativePanelFixture(make);
  try { await f.button("Sign in with YNX Wallet").props.onClick(); finish(); await new Promise(r => setImmediate(r)); await f.button("Sign in with YNX Wallet").props.onClick(); assert.equal(begins, 2); }
  finally { f.unmount(); }
});

test("missing native producer is reported and never substituted by legacy completion", async () => {
  const f = await nativePanelFixture(() => { throw Error("ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED"); });
  try { await f.button("Sign in with YNX Wallet").props.onClick(); assert.ok(f.state.includes("ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED")); await f.callback("unowned"); assert.equal(f.calls.some(x => x.startsWith("legacy")), false); }
  finally { f.unmount(); }
});

test("Developer consumes the accepted Wallet v2 package through its root factory only", async () => {
  const [runtime, panel, mac, release] = await Promise.all([
    read("frontend/src/wallet/product-session-v2.ts"),
    read("frontend/src/chain/ChainPanel.tsx"),
    read("desktop/macos/main.m"),
    read("product-release.json"),
  ]);
  assert.match(runtime, /createProductWalletConnection/);
  const [supplierRaw, closureRaw] = await Promise.all([read("vendor/wallet-auth-c5/SUPPLIER_MANIFEST.json"), read("vendor/wallet-auth-c5/SOURCE_CLOSURE.json")]);
  const supplier = JSON.parse(supplierRaw), closure = JSON.parse(closureRaw), hash = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(supplier.files.length, 276); assert.equal(closure.files.length, 276);
  assert.equal(supplier.sourceCommit, null); assert.equal(supplier.sourceTree, null);
  assert.equal(supplier.composition.base.sourceCommit, "aa65ea80525e1956214cf4c8848093034e52c77d");
  assert.equal(supplier.composition.normalR7NpmProjection.adoptedWholePackage, false);
  assert.equal(supplier.composition.deltas.length, 1);
  assert.equal(supplier.composition.deltas[0].path, "src/wallet-connection-coordinator.js");
  assert.equal(supplier.composition.deltas[0].sha256, "b757fb45c464dfe74aa763e5c87a941ac2e65d4809f1aa62ee055890b9cad674");
  assert.equal(supplier.contentRoot, hash(JSON.stringify(supplier.files)));
  assert.equal(closure.contentRoot, supplier.contentRoot); assert.equal(supplier.protectedCapabilitySupplied, false); assert.equal(closure.protectedCapabilitySupplied, false);
  for (const file of supplier.files) {
    const body = await readFile(new URL("vendor/wallet-auth-c5/" + file.path, root));
    assert.equal(body.length, file.bytes, file.path); assert.equal(hash(body), file.sha256, file.path);
    const entry = closure.files.find(x => x.path === "packages/wallet-auth/" + file.path);
    assert.ok(entry, file.path); assert.equal(entry.sha256, file.sha256, file.path);
  }
  assert.ok(runtime.includes(hash(supplierRaw))); assert.ok(runtime.includes(hash(closureRaw))); assert.ok(runtime.includes(supplier.contentRoot));
  assert.match(runtime, /https:\/\/wallet-auth\.ynxweb4\.com/);
  assert.doesNotMatch(runtime, /ProductSessionGatewayFetchAdapter|RecoverableProductSessionClient|gatewayEndpoint|callback:\s*|origin:\s*|session:\s*/);
  assert.match(runtime, /protectedStorage/);
  assert.match(mac, /kSecClassGenericPassword/);
  assert.match(mac, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(mac, /storage-get/);
  assert.match(mac, /wallet-availability/);
  assert.match(mac, /URLForApplicationToOpenURL:parts\.URL/);
  assert.doesNotMatch(mac, /availability_probe_not_opened/);
  assert.match(mac, /\[A-Za-z0-9_-\]\{80,8192\}/);
  assert.match(runtime, /walletAvailability/);
  assert.doesNotMatch(runtime, /walletInstalled:\s*async \(\) => true/);
  assert.match(panel, /Continue as Guest \/ Try mode/);
  assert.match(panel, /beginDeveloperWalletV2Connection/);
  assert.match(panel, /connection\.beginYNX\(/);
  assert.match(panel, /connection\.handleReturn\(callbackURL\)/);
  assert.doesNotMatch(panel, /openDeveloperWalletReview|createDeveloperWalletCompletion|completeDeveloperWalletSession/);
  assert.match(panel, /A degraded optional Product Session never disconnects Standard Wallet/);
  assert.match(panel, /connectDeveloperWebWallet\(providerKind\)/);
  assert.match(panel, /Product Session remains optional and separate/);
  const truth = JSON.parse(release);
  assert.equal(truth.schemaVersion, 2);
  assert.equal(truth.commit, null);
  assert.equal(truth.currentPublicCandidate, null);
  assert.equal(truth.sourceStatus.status, "OWNED_SOURCE_FROZEN_NOT_FORMALLY_RELEASED");
  assert.match(truth.currentPublicObservation.scope, /gateway source\/status only; not native or business acceptance/);
  assert.equal(truth.featureStatus.ynxCodePlatform.publicDeployment.formalNativePublication, false);
  assert.equal(truth.featureStatus.ynxCodePlatform.fullNativeWorkbenchAccepted, false);
  assert.equal(truth.acceptanceGates.canonicalRealWalletUserJourney, "NOT_RUN");
  assert.equal(truth.acceptanceGates.actualWalletBusinessApproval, "NOT_RUN");
  for (const field of ["integratedCentral", "deployedPublic", "releasePublished", "productionSigned", "fullProductAccepted"]) assert.equal(truth[field], false);
  assert.equal(Object.hasOwn(truth, "walletProductSessionV2"), false);
});
