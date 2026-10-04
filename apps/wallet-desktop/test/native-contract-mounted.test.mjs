import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
const address = "0x"+"1".repeat(40);
const tick = () => new Promise(resolve => setImmediate(resolve));
test("actual mounted contract entry, lookup, method selection, read and close use only the public IPC", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const uiSource = await readFile(new URL("../src/native-contract-ui.mjs", import.meta.url), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map(), calls = [];
  const element = () => ({value: "", textContent: "", hidden: false, disabled: false, open: false, children: [], listeners: new Map(),
    addEventListener(type, fn) {this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);},
    async emit(type) {for (const fn of this.listeners.get(type) ?? []) await fn({preventDefault() {}}); await tick();},
    showModal() {this.open = true;}, focus() {}, replaceChildren() {this.children = [];}, append(...items) {this.children.push(...items);},
  });
  const get = selector => {assert.ok(ids.has(selector.slice(1)), `Actual HTML must include ${selector}`); if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector);};
  const artifact = {address, name: "SampleEVMWriteCounter", runtimeMode: "pinned-artifact-bounded-evm-subset", sourceHash: "source", deployedBytecodeHash: "bytecode", auditHash: "audit", lastUpdatedHeight: 42};
  let finishRead;
  const api = {async nativeContract(input) {
    calls.push({...input});
    if (input.action === "lookup") return {ok: true, value: {mode: input.mode, action: "lookup", artifact, methods: [{signature: "count()", selector: "0x06661abd", inputCount: 0}]}};
    return new Promise(resolve => finishRead = resolve);
  }};
  const document = {querySelector: get, getElementById: id => get("#"+id), createElement: element};
  const start = source.indexOf("const contractSheet ="), end = source.indexOf("let paymentDraftRevision", start);
  assert.ok(start >= 0 && end > start);
  // Production ESM UI and renderer run in the same renderer realm. The prior
  // fixture injected a host-realm controller, so its ordinary-object boundary
  // correctly rejected VM-created requests before IPC. Mount the exact UI in
  // the same VM and copy public IPC results into that realm like contextBridge.
  assert.match(uiSource, /export function createNativeContractUI/);
  runInNewContext(uiSource.replace("export function createNativeContractUI", "function createNativeContractUI")+
    "\nwindow.ynxWallet.nativeContract=async input=>JSON.parse(JSON.stringify(await hostNativeContract(input)));\n"+
    source.match(/function copyUI\([^\n]+/)[0]+"\n"+source.slice(start, end),
    {document, window: {ynxWallet: {}}, hostNativeContract: api.nativeContract.bind(api), accountState: null, keyState: {locked: true, revision: 1}});
  get("#contract-mode").value = "bft"; get("#contract-address").value = address;
  await get("#open-contracts").emit("click"); assert.equal(get("#contract-sheet").open, true);
  await get("#lookup-contract").emit("click");
  assert.deepEqual(calls[0], {mode: "bft", address, action: "lookup"});
  const method = get("#contract-methods").children[0]; assert.equal(method.textContent, "count()");
  await method.emit("click"); assert.equal(get("#contract-function").value, "0x06661abd");
  await get("#contract-form").emit("submit");
  assert.deepEqual(calls[1], {mode: "bft", address, action: "read", function: "0x06661abd"});
  finishRead({ok: true, value: {mode: "bft", action: "read", read: {artifact, returnValue: "12", encodedResult: "0x0c", opcodeStepCount: 24, origin: "https://rpc-testnet.ynxweb4.com", asOf: "2026-10-03T00:00:00Z", truthfulStatus: "bft-bounded-static-read-no-sign-no-broadcast"}}}); await tick();
  assert.match(get("#contract-result").textContent, /Result: 12/);
  await get("#contract-form").emit("submit"); get("#contract-sheet").open = false; await get("#contract-sheet").emit("close");
  finishRead({ok: true, value: {mode: "bft", action: "read", read: {artifact, returnValue: "old", truthfulStatus: "bft-bounded-static-read-no-sign-no-broadcast"}}}); await tick();
  assert.equal(get("#contract-result").textContent, ""); assert.equal(get("#contract-result").hidden, true);
});
test("contract IPC uses the trusted local frame and canonical net read client, not a signer", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  assert.match(main, /handleWalletIPC\("wallet:native-contract"/);
  assert.match(main, /new NativeContractClient\(CANONICAL_RPC_URL, net.fetch.bind\(net\)\)/);
  assert.match(preload, /nativeContract: input => ipcRenderer.invoke\("wallet:native-contract", input\)/);
});
