import assert from "node:assert/strict";
import test from "node:test";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import {needsOfflineKeyRecovery,reviewRecoveryKey} from "./recoveryReview";
const secret="1".padStart(64,"0"),other="2".padStart(64,"0");
const account={...walletIdentity(secret),label:"Existing fixture",createdAt:"2026-09-06T00:00:00.000Z",backupConfirmed:true};
test("recovery review matches exact public identity without exposing the entered offline key",()=>{
  const review=reviewRecoveryKey(secret,[account]);
  assert.deepEqual(review,{kind:"existing",account});
  assert.equal(JSON.stringify(review).includes(secret),false);
  assert.deepEqual(reviewRecoveryKey(other,[account]),{kind:"new",account:walletIdentity(other).account});
  assert.deepEqual(reviewRecoveryKey("not-a-key",[account]),{kind:"invalid"});
  assert.deepEqual(reviewRecoveryKey("0".repeat(64),[account]),{kind:"invalid"});
});
test("lost protection recovery guidance is distinct from user cancellation and network failure",()=>{
  assert.equal(needsOfflineKeyRecovery("This account's protected key is unavailable or biometric enrollment changed. Restore it with its offline recovery key; the public account has been retained."),true);
  assert.equal(needsOfflineKeyRecovery("Biometric authorization was cancelled"),false);
  assert.equal(needsOfflineKeyRecovery("Auth is unavailable. Check your connection and retry."),false);
});
