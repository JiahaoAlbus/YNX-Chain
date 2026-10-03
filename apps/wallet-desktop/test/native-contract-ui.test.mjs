import test from "node:test";
import assert from "node:assert/strict";
import {createNativeContractUI} from "../src/native-contract-ui.mjs";
const address = "0x"+"1".repeat(40);
const input = {mode: "bft", action: "read", address, function: "0x06661abd"};
const response = {ok: true, value: {mode: "bft", action: "read", read: {artifact: {address}, truthfulStatus: "bft-bounded-static-read-no-sign-no-broadcast"}}};
function harness(request = async () => response) {
  const context = {open: true, account: address, keyRevision: 1}, views = [];
  const ui = createNativeContractUI({getContext: () => ({...context}), request, render: view => views.push(view)});
  return {ui, context, views};
}
test("contract modal accepts only matching read-only response identity and runtime", async () => {
  const {ui, views} = harness(); await ui.run(input);
  assert.equal(views.at(-1).result.read.artifact.address, address); assert.equal(views.at(-1).busy, false);
  for (const patch of [{mode: "legacy"}, {action: "lookup"}, {read: {...response.value.read, truthfulStatus: "full_evm_success"}}, {read: {...response.value.read, artifact: {address: "0x"+"2".repeat(40)}}}]) {
    const h = harness(async () => ({ok: true, value: {...response.value, ...patch}})); await h.ui.run(input);
    assert.equal(h.views.at(-1).result, null); assert.ok(h.views.at(-1).error);
  }
});
for (const change of ["account", "lock", "close", "edit", "same-account-reopen", "newer-read"]) {
  test(`contract modal fences late result after ${change}`, async () => {
    let complete;
    const h = harness(() => new Promise(resolve => complete = resolve));
    const pending = h.ui.run(input), oldComplete = complete;
    if (change === "account") h.context.account = "0x"+"2".repeat(40);
    if (change === "lock") h.context.keyRevision++;
    if (change === "close") h.context.open = false;
    if (["edit", "same-account-reopen"].includes(change)) h.ui.clear();
    let newer;
    if (change === "newer-read") newer = h.ui.run(input);
    const viewBefore = h.views.at(-1); oldComplete(response); await pending;
    assert.equal(h.views.at(-1), viewBefore);
    if (newer) { complete(response); await newer; assert.ok(h.views.at(-1).result); }
  });
}
test("read failure is actionable and never echoes untrusted server content", async () => {
  const h = harness(async () => ({ok: false, error: {code: "NATIVE_CONTRACT_READ_TIMEOUT", message: "<script>secret</script>"}}));
  await h.ui.run(input); assert.match(h.views.at(-1).error, /timed out/); assert.doesNotMatch(h.views.at(-1).error, /secret/);
});
