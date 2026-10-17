import assert from "node:assert/strict";
import test from "node:test";
import {WalletConnectRequestReplayStore,createWalletConnectSessionApproval,finalizeWalletConnectRequestReview,reviewWalletConnectSessionProposal} from "@ynx-chain/wallet-auth";
import type {WalletConnectRequest} from "./runtime";
import {WalletConnectReviewRecovery} from "./reviewRecovery";
import {WalletConnectSecurityStore} from "./securityStore";
const now=new Date("2026-10-01T00:00:00.000Z"),seconds=now.getTime()/1000,account="0x"+"a".repeat(40),topic="b".repeat(64);
function fixture(){
  const proposal={id:1,verifyContext:{verified:{origin:"https://example.com",validation:"VALID",verifyUrl:"https://verify.walletconnect.com/",isScam:false}},params:{id:1,expiryTimestamp:seconds+3600,relays:[{protocol:"irn"}],proposer:{publicKey:"c".repeat(64),metadata:{name:"Unit fixture",description:"Unit fixture",url:"https://example.com/",icons:["https://example.com/icon.png"]}},requiredNamespaces:{eip155:{chains:["eip155:6423"],methods:["eth_accounts"],events:["accountsChanged","chainChanged"]}},optionalNamespaces:{},pairingTopic:"d".repeat(64)}};
  const session=createWalletConnectSessionApproval(reviewWalletConnectSessionProposal(proposal,{account,now}),{approved:true,topic},now);
  const event={topic,id:2,verifyContext:proposal.verifyContext,params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[]}}} as WalletConnectRequest;
  return {session,event};
}
test("same original event can be reviewed after unlock without resetting its durable reservation or extending expiry",()=>{
  const {session,event}=fixture(),recovery=new WalletConnectReviewRecovery(),store=new WalletConnectRequestReplayStore();
  const original=recovery.review(event,session,store,now);recovery.remember(event,original,now);
  const persisted=JSON.stringify(store.snapshot()),restored=new WalletConnectRequestReplayStore(store.snapshot());
  const fresh=recovery.review(event,session,restored,new Date(now.getTime()+10000));
  assert.deepEqual(fresh,original);assert.equal(JSON.stringify(restored.snapshot()),persisted);
  finalizeWalletConnectRequestReview(fresh,{approved:true},restored,new Date(now.getTime()+10000));
  assert.throws(()=>recovery.review(event,session,restored,new Date(now.getTime()+11000)),/already decided/);
});
test("a new SDK event, mutated payload, expired draft, missing or consumed reservation cannot resume an old review",()=>{
  for(const action of ["new-event","payload","expired","missing","consumed"]){
    const {session,event}=fixture(),recovery=new WalletConnectReviewRecovery(),store=new WalletConnectRequestReplayStore();
    const original=recovery.review(event,session,store,now);recovery.remember(event,original,now);
    if(action==="payload")event.params.request.method="eth_chainId";
    if(action==="consumed")finalizeWalletConnectRequestReview(original,{approved:false},store,now);
    assert.throws(()=>recovery.review(action==="new-event"?{...event}:event,session,action==="missing"?new WalletConnectRequestReplayStore():store,action==="expired"?new Date(original.expiresAt):new Date(now.getTime()+10000)));
  }
});

test("concurrent replay consumption and session writes never roll a consumed decision back to reserved",async()=>{
  let value:string|null=null;const security=new WalletConnectSecurityStore({getItem:async()=>value,setItem:async(_key:string,next:string)=>{await Promise.resolve();value=next},deleteItem:async()=>{value=null}});
  const {session,event}=fixture(),recovery=new WalletConnectReviewRecovery();await security.saveSession(session);
  const review=await security.updateReplay(store=>recovery.review(event,session,store,now)),stale=(await security.load()).replayStore;
  await Promise.all([security.updateReplay(store=>finalizeWalletConnectRequestReview(review,{approved:true},store,now)),security.saveSession(session)]);
  await assert.rejects(security.saveReplay(stale),/cannot move backwards/);
  assert.equal((await security.load()).replayStore.snapshot()[0]?.status,"consumed");
  await assert.rejects(security.updateReplay(store=>finalizeWalletConnectRequestReview(review,{approved:true},store,now)));
  await security.removeSession(topic);assert.equal((await security.load()).replayStore.snapshot()[0]?.status,"consumed");
});
