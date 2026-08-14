import assert from "node:assert/strict";
import { test } from "node:test";
import { initialLockState, isSelectedAccountUnlocked, reduceLockState } from "./lockState";

test("every process restart is locked and backgrounding clears unlocked account",()=>{
  const first=initialLockState();
  assert.deepEqual(first,{locked:true,unlockedAccount:null,reason:"restart"});
  const unlocked=reduceLockState(first,{type:"unlock",account:"ynx1account"});
  assert.equal(unlocked.locked,false);
  assert.deepEqual(reduceLockState(unlocked,{type:"lock",reason:"background"}),{locked:true,unlockedAccount:null,reason:"background"});
  assert.deepEqual(reduceLockState(unlocked,{type:"lock",reason:"restart"}),{locked:true,unlockedAccount:null,reason:"restart"});
  assert.deepEqual(initialLockState(),first);
});

test("every account switch relocks and clears the previously authorized account",()=>{
  const locked=initialLockState();
  assert.deepEqual(reduceLockState(locked,{type:"switch",account:"other"}),{locked:true,unlockedAccount:null,reason:"account-switch"});
  const unlocked=reduceLockState(locked,{type:"unlock",account:"one"});
  assert.deepEqual(reduceLockState(unlocked,{type:"switch",account:"two"}),{locked:true,unlockedAccount:null,reason:"account-switch"});
  assert.deepEqual(reduceLockState(unlocked,{type:"switch",account:"one"}),{locked:true,unlockedAccount:null,reason:"account-switch"});
});

test("Dashboard authorization is bound to the exact selected account",()=>{
  const unlocked=reduceLockState(initialLockState(),{type:"unlock",account:"one"});
  assert.equal(isSelectedAccountUnlocked(unlocked,"one"),true);
  assert.equal(isSelectedAccountUnlocked(unlocked,"two"),false);
  assert.equal(isSelectedAccountUnlocked(reduceLockState(unlocked,{type:"switch",account:"two"}),"two"),false);
});
