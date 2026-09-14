import assert from "node:assert/strict";
import { test } from "node:test";
import { readAuthoritativeChainAccount } from "./chainRead";
import type { ChainAccount, ChainActivity } from "./nativeTransfer";

const account:ChainAccount=Object.freeze({address:"0x0000000000000000000000000000000000000001",balance:23,nonce:1,source:"native-rest",materialized:true});
const activity:ChainActivity=Object.freeze({hash:`0x${"1".repeat(64)}`,type:"transfer",from:account.address,to:"0x0000000000000000000000000000000000000002",amount:1,fee:0,nonce:1});

test("verified balance and nonce survive an independent activity transport outage",async()=>{
  const result=await readAuthoritativeChainAccount({account:async()=>account,activity:async()=>{throw new Error("RPC_UNAVAILABLE: activity transport is unavailable")}},"ynx1account");
  assert.equal(result.account,account);
  assert.deepEqual(result.activity,[]);
  assert.equal(result.activityError,"RPC_UNAVAILABLE: activity transport is unavailable");
});

test("a failed authoritative account read never becomes a partial Wallet success",async()=>{
  await assert.rejects(()=>readAuthoritativeChainAccount({account:async()=>{throw new Error("RPC_UNAVAILABLE: account transport is unavailable")},activity:async()=>[activity]},"ynx1account"),/account transport/);
});

test("a fully authoritative account and activity result stays unchanged",async()=>{
  const result=await readAuthoritativeChainAccount({account:async()=>account,activity:async()=>Object.freeze([activity])},"ynx1account");
  assert.equal(result.account,account);
  assert.deepEqual(result.activity,[activity]);
  assert.equal(result.activityError,undefined);
});
