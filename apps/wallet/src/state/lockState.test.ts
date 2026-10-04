import assert from "node:assert/strict";
import { test } from "node:test";
import { initialLockState, reduceLockState } from "./lockState";

test("every process restart is locked and backgrounding clears unlocked account",()=>{
  const first=initialLockState();
  assert.deepEqual(first,{locked:true,unlockedAccount:null,reason:"restart"});
  const unlocked=reduceLockState(first,{type:"unlock",account:"ynx1account"});
  assert.equal(unlocked.locked,false);
  assert.deepEqual(reduceLockState(unlocked,{type:"lock",reason:"background"}),{locked:true,unlockedAccount:null,reason:"background"});
  assert.deepEqual(initialLockState(),first);
});

test("account switching requires an unlocked Wallet",()=>{
  const locked=initialLockState();
  assert.equal(reduceLockState(locked,{type:"switch",account:"other"}),locked);
  const switched=reduceLockState(reduceLockState(locked,{type:"unlock",account:"one"}),{type:"switch",account:"two"});
  assert.equal(switched.unlockedAccount,"two");
});
