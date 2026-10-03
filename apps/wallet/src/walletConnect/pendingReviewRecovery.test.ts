import assert from "node:assert/strict";
import test from "node:test";
import {WalletConnectViewOperations} from "./viewOperations";
import {readFileSync} from "node:fs";
import {PendingReviewRecovery,pendingSessionBinding} from "./pendingReviewRecovery";
import {WalletConnectRuntime} from "./runtime";
import {WalletConnectPairingJournal} from "./securityStore";
import {WalletConnectRequestReplayStore,reviewWalletConnectSessionProposal,createWalletConnectSessionApproval,finalizeWalletConnectRequestReview} from "@ynx-chain/wallet-auth";
import {WalletConnectReviewRecovery} from "./reviewRecovery";
import {WalletConnectSecurityStore} from "./securityStore";
import ts from "typescript";
const account="0x"+"a".repeat(40),topic="b".repeat(64),pairTopic="c".repeat(64);
function storage(){const values=new Map<string,string>();return{values,getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value);},deleteItem:async(key:string)=>{values.delete(key);}};}
function fixture(){const now=Date.now(),expiry=Math.floor(now/1000)+250;
 const verification={verified:{origin:"https://example.com",validation:"VALID",verifyUrl:"https://verify.walletconnect.com",isScam:false}};
 const proposal={id:10,verifyContext:verification,params:{id:10,pairingTopic:pairTopic,expiryTimestamp:expiry,proposer:{publicKey:"d".repeat(64),metadata:{name:"Fixture",url:"https://example.com",description:"Isolated SDK fixture",icons:["https://example.com/icon.png"]}},requiredNamespaces:{eip155:{chains:["eip155:6423"],methods:["eth_accounts"],events:[]}},optionalNamespaces:{},relays:[{protocol:"irn"}]}};
 const session={topic,pairingTopic:"e".repeat(64),expiry:expiry+100,namespaces:{eip155:{accounts:[`eip155:6423:${account}`],methods:["eth_accounts"],events:[]}},peer:{metadata:{url:"https://example.com"}}};
 const event={topic,id:11,verifyContext:verification,params:{chainId:"eip155:6423",request:{method:"eth_accounts",params:[]}}};return{now,expiry,proposal,session,event};
}
function client(f:ReturnType<typeof fixture>,requests:any[]=[],proposals:any[]=[]){const handlers=new Map<string,(value:any)=>any>(),responses:any[]=[],rejections:any[]=[];let approves=0;
 return{handlers,responses,rejections,get approves(){return approves;},core:{pairing:{getPairings:()=>[{topic:pairTopic,expiry:f.expiry}],disconnect:async()=>{}}},getPendingSessionRequests:()=>requests,getPendingSessionProposals:()=>proposals,getActiveSessions:()=>({[topic]:f.session}),on:(name:string,handler:any)=>{handlers.set(name,handler);},pair:async()=>{},approveSession:async()=>{approves++;return f.session;},rejectSession:async(value:any)=>{rejections.push(value);},respondSessionRequest:async(value:any)=>{responses.push(value);},disconnectSession:async()=>{}};
}
test("missing original record fails closed before a decision or remembered review",async()=>{
 const s=storage(),f=fixture(),store=new PendingReviewRecovery(s);await store.capture("request",f.event as any,account,pendingSessionBinding(f.session),new Date(f.now),f.now+120000);
 s.values.clear();let signs=0;
 await assert.rejects(async()=>{await store.decide("request",f.event);signs++;},{code:"WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE"});assert.equal(signs,0);
 await assert.rejects(store.remember(f.event as any,{expiresAt:new Date(f.now+100000).toISOString(),requestDigest:"x"} as any,new Date(f.now),()=>{}),{code:"WALLETCONNECT_ORIGINAL_REVIEW_UNAVAILABLE"});
 await store.end("request",f.event); // Cleanup alone is idempotent.
});
test("cold request preserves original arrival/deadline and only original undecided wire/account/session",async()=>{
 const s=storage(),f=fixture();let time=f.now;const store=new PendingReviewRecovery(s,()=>time),binding=pendingSessionBinding(f.session);await store.capture("request",f.event as any,account,binding,new Date(f.now),f.now+120000);time+=30000;
 const cold=new PendingReviewRecovery(s,()=>time),restored=await cold.recover("request",f.event,account,binding);assert.equal(restored.receivedAt,f.now);assert.equal(restored.deadline,f.now+120000);
 for(const [event,who,session] of [[{...f.event,params:{...f.event.params,request:{method:"eth_chainId",params:[]}}},account,binding],[f.event,"0x"+"e".repeat(40),binding],[f.event,account,"changed"]] as any[])await assert.rejects(cold.recover("request",event,who,session));
 await cold.decide("request",f.event);await assert.rejects(new PendingReviewRecovery(s,()=>time).recover("request",f.event,account,binding));
 await assert.rejects(cold.capture("request",f.event as any,account,binding,new Date(time),time+120000));
});
test("write readback failure and original expiry cannot authorize execution",async()=>{
 const s=storage(),f=fixture();let time=f.now;const store=new PendingReviewRecovery(s,()=>time);await store.capture("request",f.event as any,account,"session",new Date(time),time+1000);time+=1001;await assert.rejects(store.decide("request",f.event));
 const unreliable={...storage(),setItem:async()=>{}};await assert.rejects(new PendingReviewRecovery(unreliable).capture("request",f.event as any,account,"session",new Date(f.now),f.now+120000),{code:"WALLETCONNECT_RECOVERY_WRITE_UNCONFIRMED"});
});
test("a damaged identified review is quarantined without inventing its deadline or blocking unrelated fresh requests",async()=>{
 const s=storage(),f=fixture(),store=new PendingReviewRecovery(s);await store.capture("request",f.event as any,account,"session",new Date(f.now),f.now+120000);const key="ynx.wallet.walletconnect.pending-reviews.v1",encoded=JSON.parse(s.values.get(key)!);delete encoded.records[0].deadline;s.values.set(key,JSON.stringify(encoded));const restored=new PendingReviewRecovery(s);
 await assert.rejects(restored.decide("request",f.event));await assert.rejects(restored.capture("request",f.event as any,account,"session",new Date(f.now),f.now+120000));const fresh={...f.event,id:12};await restored.capture("request",fresh as any,account,"session",new Date(f.now),f.now+120000);await restored.decide("request",fresh);await assert.rejects(new PendingReviewRecovery(s).capture("request",f.event as any,account,"session",new Date(f.now),f.now+120000));assert.equal(JSON.parse(s.values.get(key)!).quarantined.length,1);
});
test("native cold pending restores no automatic response and refuses decided or missing original deadline",async()=>{
 for(const mode of ["undecided","decided","missing"]){const s=storage(),f=fixture(),store=new PendingReviewRecovery(s);if(mode!=="missing")await store.capture("request",f.event as any,account,pendingSessionBinding(f.session),new Date(f.now),f.now+120000);if(mode==="decided")await store.decide("request",f.event);
 const sdk=client(f,[f.event]),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>sdk) as any,30000,new WalletConnectPairingJournal(s),new PendingReviewRecovery(s));await runtime.start();await runtime.resumeAfterUnlock(account);
 assert.equal(Boolean(runtime.snapshot().request),mode==="undecided");assert.equal(sdk.responses.some(r=>"result" in r.response),false);if(mode!=="undecided")assert.equal(sdk.responses.length,1);
 }
});
test("original proposal needs both eligible pending record and explicit non-quarantined journal review",async()=>{
 for(const quarantined of [false,true]){const s=storage(),f=fixture(),store=new PendingReviewRecovery(s),journal=new WalletConnectPairingJournal(s);await store.capture("proposal",f.proposal as any,account,null,new Date(f.now),f.now+120000,true);await journal.review(pairTopic,f.expiry);if(quarantined)await journal.record(pairTopic,f.expiry);
 const sdk=client(f,[],[f.proposal.params]),runtime=new WalletConnectRuntime({projectId:"f".repeat(32)},(async()=>sdk) as any,30000,journal,new PendingReviewRecovery(s));await runtime.start();await runtime.resumeAfterUnlock(account);
 assert.equal(Boolean(runtime.snapshot().proposal),!quarantined);assert.equal(sdk.approves,0);if(!quarantined){assert.equal(runtime.snapshot().proposal?.verifyContext.verified.validation,"VALID");runtime.pauseForLock(account);assert.equal(runtime.snapshot().proposal,null);assert.equal(await runtime.resumeAfterUnlock(account),true);assert.equal(runtime.snapshot().proposal?.id,10);await runtime.rejectProposal();await assert.rejects(store.recover("proposal",{id:10,params:f.proposal.params},account,null));}else assert.equal(sdk.rejections.length,1);
 }
});
test("native actual Modal authenticates before durable decision and decision precedes key use",()=>{
 const source=readFileSync(new URL("./WalletConnectModal.tsx",import.meta.url),"utf8"),decision=source.slice(source.indexOf("const decideRequest="),source.indexOf("const checkBroadcast="));
 assert.ok(decision.indexOf("withAccountSecret")<decision.lastIndexOf("await commitDecision()"));
 const keyUse=decision.slice(decision.indexOf("result=await withAccountSecret"));assert.ok(keyUse.indexOf("await commitDecision()")<keyUse.indexOf("signNativeSignIn"));assert.ok(keyUse.indexOf("await commitDecision()")<keyUse.indexOf("signPreparedEvmRequest"));assert.match(decision,/if\(committing\)/);
});
test("SDK optional-only namespace yields minimum YNX permission and cold review retains its original durable reservation",async()=>{
 const s=storage(),f=fixture();f.proposal.params.optionalNamespaces=f.proposal.params.requiredNamespaces;f.proposal.params.requiredNamespaces={} as any;
 const proposalReview=reviewWalletConnectSessionProposal(f.proposal,{account,now:new Date(f.now)});assert.deepEqual(proposalReview.namespaces.eip155.methods,["eth_accounts"]);assert.deepEqual(proposalReview.namespaces.eip155.chains,["eip155:6423"]);
 const approval=createWalletConnectSessionApproval(proposalReview,{approved:true,topic},new Date(f.now)),replay=new WalletConnectRequestReplayStore(),warm=new WalletConnectReviewRecovery(),pending=new PendingReviewRecovery(s);
 await pending.capture("request",f.event as any,account,pendingSessionBinding(f.session),new Date(f.now),Math.floor(f.now/1000)*1000+300000);
 const review=warm.review(f.event as any,approval,replay,new Date(f.now));await pending.remember(f.event as any,review,new Date(f.now),()=>{});
 const original=await new PendingReviewRecovery(s).recover("request",f.event,account,pendingSessionBinding(f.session)),cold=new WalletConnectReviewRecovery(),reserved=new WalletConnectRequestReplayStore(replay.snapshot());cold.remember(original.event,original.review!,new Date(original.reviewedAt!));
 assert.deepEqual(cold.review(original.event,approval,reserved,new Date(f.now+10000)),review);assert.equal(reserved.snapshot()[0]?.status,"reserved");
 finalizeWalletConnectRequestReview(review,{approved:false},reserved,new Date(f.now+10000));assert.throws(()=>cold.review(original.event,approval,reserved,new Date(f.now+11000)),/already decided/);
});
test("actual Native approval handler keeps failed authentication undecided, retries once, and never signs a missing original record",async()=>{
 const source=readFileSync(new URL("./WalletConnectModal.tsx",import.meta.url),"utf8"),handler=source.slice(source.indexOf("  const startViewOperation"),source.indexOf("  const disconnect ="))+source.slice(source.indexOf("  const decideRequest="),source.indexOf("  const checkBroadcast="));
 for(const mode of ["auth-retry","missing"]){const s=storage(),f=fixture();f.proposal.params.requiredNamespaces.eip155.methods=["personal_sign"];f.event.params.request={method:"personal_sign",params:["0x01",account]} as any;f.session.namespaces.eip155.methods=["personal_sign"];
 const approval=createWalletConnectSessionApproval(reviewWalletConnectSessionProposal(f.proposal,{account,now:new Date(f.now)}),{approved:true,topic},new Date(f.now)),securityStore=new WalletConnectSecurityStore(s),pending=new PendingReviewRecovery(s),recovery=new WalletConnectReviewRecovery();await securityStore.saveSession(approval);await pending.capture("request",f.event as any,account,pendingSessionBinding(f.session),new Date(f.now),Math.floor(f.now/1000)*1000+300000);const review=await securityStore.updateReplay(replay=>recovery.review(f.event as any,approval,replay,new Date(f.now)));await pending.remember(f.event as any,review,new Date(f.now),()=>{});if(mode==="missing")s.values.delete("ynx.wallet.walletconnect.pending-reviews.v1");
 let authenticate=false,signs=0;const replies:any[]=[],runtime={requestRecovery:()=>pending.get(f.event as any),decideReviewedRequest:()=>pending.decide("request",f.event),requestOutcomeUnconfirmed:()=>pending.end("request",f.event),bindReviewedRequest:()=>({assertCurrent(){},reject:async(code:number)=>{replies.push({error:code});},respond:async(result:any)=>{await pending.assertDecided(f.event as any);replies.push({result});}})};
 const viewOperations=new WalletConnectViewOperations();viewOperations.setAccount("synthetic-native-account");const context:any={viewOperations,walletConnectNativeOutbox:{read:async()=>null},setNativePending(){},finalizeWalletConnectRequestReview,requestReview:review,reviewedEvent:{current:f.event},walletConnectRuntime:runtime,securityStore,evmAddress:account,account:{account:"synthetic-native-account"},nativePrepared:{kind:"product"},prepared:null,broadcastJournal:{read:async()=>null},setBusy(){},setError(){},setBroadcast(){},setRequestReview(){},setPrepared(){},walletConnectRejection:()=>({code:5000,message:"Rejected"}),message:(error:Error)=>error.message,evmAddressFromYNX:()=>account,signNativeSignIn:()=>{signs++;return "synthetic-result";},withAccountSecret:async(_account:any,_assert:any,use:any)=>{if(!authenticate)throw new Error("Authentication canceled");return use("synthetic-only",()=>{});}};
 const compiled=ts.transpileModule(handler+"\nreturn decideRequest;",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,decide=new Function(...Object.keys(context),compiled)(...Object.values(context));
 if(mode==="auth-retry"){await decide(true);assert.equal(signs,0);assert.equal(replies.length,0);assert.equal((await pending.get(f.event as any))?.state,"undecided");assert.equal((await securityStore.load()).replayStore.snapshot()[0]?.status,"reserved");authenticate=true;await decide(true);assert.equal(signs,1);assert.equal(replies.length,1);assert.equal((await securityStore.load()).replayStore.snapshot()[0]?.status,"consumed");await decide(true);assert.equal(signs,1);}else{authenticate=true;await decide(true);assert.equal(signs,0);assert.equal(replies.some(reply=>"result" in reply),false);}
 }
});
