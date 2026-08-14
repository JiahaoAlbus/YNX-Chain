import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalAuthorizationAttemptCoordinator } from "./localAuthorizationAttemptPolicy";

test("lifecycle cancellation invalidates checks before a biometric prompt starts",()=>{
  const coordinator=new LocalAuthorizationAttemptCoordinator(),attempt=coordinator.begin();
  assert.equal(coordinator.cancel(),false);
  assert.throws(()=>coordinator.beginPrompt(attempt),/cancelled by Wallet lifecycle/);
});

test("an active native prompt is reported once and its result stays invalid",()=>{
  const coordinator=new LocalAuthorizationAttemptCoordinator(),attempt=coordinator.begin(),prompt=coordinator.beginPrompt(attempt);
  assert.equal(coordinator.cancel(),true);
  assert.equal(coordinator.cancel(),false);
  coordinator.finishPrompt(prompt);
  assert.throws(()=>coordinator.assertActive(attempt),/cancelled by Wallet lifecycle/);
});

test("finishing an old prompt cannot clear or authorize a newer attempt",()=>{
  const coordinator=new LocalAuthorizationAttemptCoordinator(),first=coordinator.begin(),oldPrompt=coordinator.beginPrompt(first);
  coordinator.cancel();
  const second=coordinator.begin(),newPrompt=coordinator.beginPrompt(second);
  coordinator.finishPrompt(oldPrompt);
  assert.equal(coordinator.cancel(),true);
  coordinator.finishPrompt(newPrompt);
  assert.throws(()=>coordinator.assertActive(second),/cancelled by Wallet lifecycle/);
});
