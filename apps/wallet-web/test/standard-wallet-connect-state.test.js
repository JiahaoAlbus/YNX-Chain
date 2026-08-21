import assert from "node:assert/strict";
import test from "node:test";
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
} from "../src/standard-wallet-connect-state.js";

const ACCOUNT=`0x${"1".repeat(40)}`;

function connected(){
  let state=createStandardWalletConnectState();
  state=reduceStandardWalletConnectState(state,{type:"BEGIN",pendingIntent:"connect_1234567890abcdef"});
  state=reduceStandardWalletConnectState(state,{type:"PROVIDER_SELECTED",providerKind:"metamask"});
  state=reduceStandardWalletConnectState(state,{type:"ACCOUNT_APPROVED",account:ACCOUNT});
  return reduceStandardWalletConnectState(state,{type:"CHAIN_CONFIRMED",chainId:"0x1917"});
}

test("approved account and provider chain close chooser and clear pending intent",()=>{
  const state=connected();
  assert.deepEqual({status:state.status,chooserOpen:state.chooserOpen,pendingIntent:state.pendingIntent,focus:state.focusRestoreTarget},{status:"connected",chooserOpen:false,pendingIntent:null,focus:"wallet-connect-trigger"});
});

test("connected details open independently and close back to the trigger",()=>{
  const details=reduceStandardWalletConnectState(connected(),{type:"OPEN_CHOOSER"});
  assert.deepEqual({open:details.chooserOpen,mode:details.chooserMode,actions:details.chooserActions},{open:true,mode:"connection-details",actions:["disconnect","switch-account","close"]});
  const closed=reduceStandardWalletConnectState(details,{type:"CLOSE_CHOOSER"});
  assert.deepEqual({open:closed.chooserOpen,mode:closed.chooserMode,focus:closed.focusRestoreTarget},{open:false,mode:"closed",focus:"wallet-connect-trigger"});
});

test("refresh restore, account change and disconnect remain provider-authoritative",()=>{
  const restored=reduceStandardWalletConnectState(createStandardWalletConnectState(),{type:"RESTORE",providerKind:"metamask",accounts:[ACCOUNT],chainId:"0x1917"});
  assert.equal(restored.status,"connected");assert.equal(restored.chooserOpen,false);
  const replacement=`0x${"2".repeat(40)}`;
  const switched=reduceStandardWalletConnectState(restored,{type:"ACCOUNTS_CHANGED",accounts:[replacement]});
  assert.equal(switched.account,replacement);assert.equal(switched.status,"connected");
  const disconnected=reduceStandardWalletConnectState(switched,{type:"DISCONNECT"});
  assert.equal(disconnected.status,"disconnected");assert.equal(disconnected.account,null);assert.equal(disconnected.chainId,null);
});

test("CORS and private service degradation preserve Standard Wallet success",()=>{
  let state=reduceStandardWalletConnectState(connected(),{type:"PRIVATE_SESSION_DEGRADED",code:"PRIVATE_SERVICE_UNAVAILABLE"});
  assert.equal(state.status,"connected");assert.equal(state.privateService,"degraded");assert.equal(state.account,ACCOUNT);
  state=reduceStandardWalletConnectState(state,{type:"RPC_PROBE_DEGRADED",probeTransport:"accepted-cors-safe",code:"RPC_CORS_BLOCKED"});
  assert.equal(state.status,"connected");assert.equal(state.rpcProbe,"degraded");assert.equal(state.account,ACCOUNT);
});

test("disconnect and empty account events clear all connected authority",()=>{
  for(const event of [{type:"DISCONNECT"},{type:"PROVIDER_DISCONNECT"},{type:"ACCOUNTS_CHANGED",accounts:[]}]){
    const state=reduceStandardWalletConnectState(connected(),event);
    assert.equal(state.status,"disconnected");assert.equal(state.account,null);assert.equal(state.chainId,null);assert.deepEqual(state.standardPermissions,[]);
  }
});

test("wrong chain never grants sign or send authority",()=>{
  const state=reduceStandardWalletConnectState(connected(),{type:"CHAIN_CHANGED",chainId:"0x1"});
  assert.equal(state.status,"wrong-chain");assert.deepEqual(state.standardPermissions,[]);assert.equal(state.productAccess,"guest-or-public-only");
});
