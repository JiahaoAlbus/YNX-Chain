import assert from "node:assert/strict";
import test from "node:test";
import {ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {WalletSessionInventoryClient,type WalletGatewayBridgeResponse} from "./sessionInventory";

const NOW=new Date("2026-07-26T08:00:00.000Z");
const ACCOUNT=ynxAddressFromEVM("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
const D="a".repeat(64),E="b".repeat(64),F="c".repeat(64);

function inventory(){
  return {schemaVersion:1,account:ACCOUNT,asOf:NOW.toISOString(),connectedApps:[{requestingProduct:"YNX Social",productClientId:"ynx-social-v1",bundleId:"com.ynxweb4.social",sessionBindings:[D],activeSessionBindings:[D],approvalDigests:[E],deviceBindings:[F],active:true}],approvals:[{approvalDigest:E,requestingProduct:"YNX Social",productClientId:"ynx-social-v1",bundleId:"com.ynxweb4.social",sessionBindings:[D],activeSessionBindings:[D],revoked:false}],devices:[{deviceBinding:F,requestingProduct:"YNX Social",productClientId:"ynx-social-v1",bundleId:"com.ynxweb4.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"unused-by-wallet-view",sessionBindings:[D],activeSessionBindings:[D],revoked:false}],sessions:[{sessionBinding:D,requestingProduct:"YNX Social",productClientId:"ynx-social-v1",bundleId:"com.ynxweb4.social",callback:"ynxsocial://wallet-auth/callback",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"unused-by-wallet-view",deviceBinding:F,approvalDigest:E,scopes:["profile:read"],purpose:"Sign in",issuedAt:"2026-07-26T07:55:00.000Z",expiresAt:"2026-07-26T09:00:00.000Z",active:true,inactiveReasons:[]}]};
}

function response(result=inventory()):WalletGatewayBridgeResponse{return {status:200,body:JSON.stringify({ok:true,result,schemaVersion:1,stateDigest:"d".repeat(64)})}}

test("Wallet runtime loads a fresh account-bound Connected Apps inventory through the proof bridge",async()=>{
  const calls:unknown[]=[];const client=new WalletSessionInventoryClient(async(request)=>{calls.push(request);return response()});
  const result=await client.load(ACCOUNT,NOW);
  assert.deepEqual(calls,[{method:"POST",path:"/v1/wallet/sessions",contentType:"application/json",body:"{}"}]);
  assert.equal(result.connectedApps[0]?.requestingProduct,"YNX Social");
  assert.equal(result.sessions[0]?.active,true);
  assert.equal(result.devices[0]?.revoked,false);
  assert.equal(result.approvalCount,1);
  assert.equal(Object.isFrozen(result.connectedApps),true);
});

test("Wallet runtime fails closed on account substitution, stale data, duplicate sessions and Gateway errors",async()=>{
  const substituted={...inventory(),account:ynxAddressFromEVM("0xffffffffffffffffffffffffffffffffffffffff")};
  await assert.rejects(()=>new WalletSessionInventoryClient(async()=>response(substituted)).load(ACCOUNT,NOW),/does not match/);
  const stale={...inventory(),asOf:"2026-07-26T07:54:59.000Z"};
  await assert.rejects(()=>new WalletSessionInventoryClient(async()=>response(stale)).load(ACCOUNT,NOW),/stale/);
  const duplicate={...inventory(),sessions:[...inventory().sessions,...inventory().sessions]};
  await assert.rejects(()=>new WalletSessionInventoryClient(async()=>response(duplicate)).load(ACCOUNT,NOW),/duplicate session/);
  const denied=new WalletSessionInventoryClient(async()=>({status:403,body:JSON.stringify({error:{code:"REVOKED"}})}));
  await assert.rejects(()=>denied.load(ACCOUNT,NOW),/403.*REVOKED/);
});

test("Wallet runtime rejects widened envelopes and unavailable bridges",async()=>{
  assert.throws(()=>new WalletSessionInventoryClient(null as never),/unavailable/);
  const widened=new WalletSessionInventoryClient(async()=>({status:200,body:JSON.stringify({...JSON.parse(response().body),unexpected:true})}));
  await assert.rejects(()=>widened.load(ACCOUNT,NOW),/envelope fields/);
});
