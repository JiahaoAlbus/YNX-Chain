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
test("truthy contract IPC success is not a verified read",async()=>{const h=harness(async()=>({...response,ok:"true"}));await h.ui.run(input);assert.equal(h.views.at(-1).result,null);assert.ok(h.views.at(-1).error);});
test("editing the dispatched input object cannot retarget an in-flight contract result",async()=>{let finish;const requested={...input},h=harness(()=>new Promise(resolve=>finish=resolve));const pending=h.ui.run(requested);requested.address="0x"+"2".repeat(40);finish({...response,value:{...response.value,read:{...response.value.read,artifact:{address:requested.address}}}});await pending;assert.equal(h.views.at(-1).result,null);assert.ok(h.views.at(-1).error);});
test("rendered contract response does not retain mutable source containers",async()=>{const value=structuredClone(response),h=harness(async()=>value);await h.ui.run(input);const result=h.views.at(-1).result;value.value.read.artifact.address="changed";assert.equal(result.read.artifact.address,address);assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.read.artifact),true);});
for(const field of ["ok","value","address"])test(`contract presentation never runs ${field} accessors`,async()=>{let reads=0;const value=structuredClone(response),target=field==="address"?value.value.read.artifact:value;Object.defineProperty(target,field,{get(){reads++;return field==="ok"?true:address}});const h=harness(async()=>value);await h.ui.run(input);assert.equal(reads,0);assert.equal(h.views.at(-1).result,null);assert.ok(h.views.at(-1).error);});
test("contract snapshot preserves shared public method metadata without treating it as a cycle",async()=>{const method={name:"count",signature:"count()",selector:"0x06661abd"},value=structuredClone(response);value.value.read.artifact.functions=[method];value.value.read.function=method;const h=harness(async()=>value);await h.ui.run(input);assert.equal(h.views.at(-1).result.read.function.signature,"count()");assert.equal(Object.isFrozen(h.views.at(-1).result.read.function),true);});
test("cyclic response and custom array iterators cannot enter the contract view",async()=>{for(const cyclic of [false,true]){let calls=0;const value=structuredClone(response);if(cyclic)value.value.self=value.value;else{value.value.methods=[];value.value.methods[Symbol.iterator]=function*(){calls++}}const h=harness(async()=>value);await h.ui.run(input);assert.equal(calls,0);assert.equal(h.views.at(-1).result,null);}});
