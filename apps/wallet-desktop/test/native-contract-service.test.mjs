import test from "node:test";
import assert from "node:assert/strict";
import {createNativeContractService} from "../src/native-contract-service.mjs";
const address = "0x"+"1".repeat(40);
const input = {mode: "bft", action: "read", address, function: "0x06661abd"};
function harness(action = async (_address, _function, guard) => {guard(); return {artifact: {address}, truthfulStatus: "bft-bounded-static-read-no-sign-no-broadcast"};}) {
  const context = {focused: true, changing: false, revision: 1, account: address}, calls = [];
  const client = {readBFT: (...args) => {calls.push("bft"); return action(...args);}, read: (...args) => {calls.push("legacy"); return action(...args);}};
  return {context, calls, request: createNativeContractService({getContext: () => ({...context}), client})};
}
test("public contract service chooses explicit runtime without needing vault, key or signing lease", async () => {
  const h = harness(); assert.equal((await h.request(input)).action, "read");
  await h.request({...input, mode: "legacy", function: "count()"}); assert.deepEqual(h.calls, ["bft", "legacy"]);
});
test("contract service rejects arbitrary origin/routes and malformed requests before any network call", async () => {
  for (const bad of [null, [], {...input, origin: "https://evil.test"}, {...input, action: "execute"}, {...input, mode: "evm"}, {...input, address: "../keys"}, {...input, function: "x".repeat(8195)}, {...input, action: "lookup"}]) {
    const h = harness(); await assert.rejects(() => h.request(bad), /valid contract/); assert.equal(h.calls.length, 0);
  }
});
for (const change of ["lock", "account", "blur", "changing"]) {
  test(`contract service stops a delayed response after ${change}`, async () => {
    let complete;
    const h = harness(() => new Promise(resolve => complete = resolve));
    const pending = h.request(input);
    if (change === "lock") h.context.revision++;
    if (change === "account") h.context.account = "0x"+"2".repeat(40);
    if (change === "blur") h.context.focused = false;
    if (change === "changing") h.context.changing = true;
    complete({}); await assert.rejects(() => pending, /context changed/);
  });
}
test("failed BFT read never retries legacy or submits a transaction", async () => {
  const h = harness(async () => {throw new Error("unavailable");});
  await assert.rejects(() => h.request(input), /unavailable/); assert.deepEqual(h.calls, ["bft"]);
});
