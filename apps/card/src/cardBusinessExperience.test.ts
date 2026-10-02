import test from 'node:test';
import assert from 'node:assert/strict';
import{createRequire}from 'node:module';
import{CardBusinessClient}from './cardBusinessClient';
const{mountGuest}=createRequire(import.meta.url)('../test/guest-experience-fixture.cjs');
const owner='0x'+'b'.repeat(40),other='0x'+'c'.repeat(40),source='a'.repeat(40),environment='YNX_TESTNET_CARD_PAYMENT_SIMULATION';
const identity={owner,sessionBinding:'binding-one',expiresAt:'2099-01-01T00:00:00Z'};
const session={state:'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY',account:owner,sessionBinding:identity.sessionBinding,expiresAt:identity.expiresAt};
const empty={environment,productionRealPayments:false,asset:'YNXT_TESTNET',applications:[],cards:[],intents:[]};
const draft={id:'application_own',owner,status:'DRAFT',details:{nickname:'Owner record alpha',useCase:'sandbox',limitWei:'100',riskAccepted:true,termsVersion:'card-testnet-v1'},createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
function client(handler:()=>Promise<Response>){return new CardBusinessClient({expectedSourceCommit:source,identity:()=>identity,createIntrospectionProof:async()=>({proofHeader:'fixture_read_proof'}),fetch:async()=>handler()});}
const response=(data:unknown)=>Response.json({schemaVersion:1,sourceCommit:source,sessionOwner:owner,environment,productionRealPayments:false,data});
test('Guest cannot fetch personal records using only Standard Wallet connectivity',async()=>{
 let reads=0;const ui=await mountGuest({props:{businessClient:client(async()=>{reads++;return response(empty);}),walletSession:{address:owner,chainId:'0x1917'},privateSession:null}});
 try{assert.equal(reads,0);assert.match(ui.text(),/separate Card private authorization/);assert.doesNotMatch(ui.text(),/Owner record alpha/);}finally{await ui.unmount();}
});
test('approved private identity loads existing records and refreshes without mutation',async()=>{
 let reads=0;const ui=await mountGuest({props:{businessClient:client(async()=>{reads++;return response({...empty,applications:[draft]});}),privateSession:session}});
 try{assert.match(ui.text(),/Owner record alpha/);assert.match(ui.text(),/application_own/);await ui.press(ui.buttons('Refresh records')[0]);assert.equal(reads,2);}finally{await ui.unmount();}
});
test('empty API state never becomes an automatically issued card or balance',async()=>{
 const ui=await mountGuest({props:{businessClient:client(async()=>response(empty)),privateSession:session}});
 try{assert.match(ui.text(),/No records returned/);assert.doesNotMatch(ui.text(),/Available YNXT \(Testnet only\):/);}finally{await ui.unmount();}
});
test('private read failure preserves guest and uses safe localized copy, not remote text',async()=>{
 const ui=await mountGuest({props:{businessClient:client(async()=>Response.json({error:{code:'CARD_AUTH_EXPIRED',message:'SECRET_REMOTE_TEXT'}},{status:401})),privateSession:session}});
 try{assert.match(ui.text(),/CARD_AUTH_EXPIRED/);assert.match(ui.text(),/Guest exploration and Standard Wallet remain available/);assert.doesNotMatch(ui.text(),/SECRET_REMOTE_TEXT/);}finally{await ui.unmount();}
});
test('identity switch hides old records synchronously and late responses cannot restore them',async()=>{
 let finish!:(value:Response)=>void;const delayed=new Promise<Response>(resolve=>{finish=resolve;});
 const ui=await mountGuest({props:{businessClient:client(async()=>delayed),privateSession:session}});
 try{await ui.update({privateSession:{...session,account:other,sessionBinding:'binding-two'},businessClient:null});finish(response({...empty,applications:[draft]}));await ui.flush();assert.doesNotMatch(ui.text(),/Owner record alpha|application_own/);assert.ok(ui.commits.filter((entry:any)=>entry.text.includes(other)).every((entry:any)=>!entry.text.includes('Owner record alpha')));}finally{await ui.unmount();}
});

test('private degraded message follows explicit locale changes without replaying remote English text',async()=>{
 const privateSession={state:'PRIVATE_SERVICE_DEGRADED',code:'PRODUCT_SESSION_GATEWAY_UNREACHABLE',safeMessage:'REMOTE_PRIVATE_YNX_ENGLISH',userAction:'retry'};
 const ui=await mountGuest({props:{privateSession}});
 try{assert.match(ui.text(),/The private request could not finish/);assert.doesNotMatch(ui.text(),/REMOTE_PRIVATE_YNX_ENGLISH/);await ui.update({locale:'zh-CN'});assert.match(ui.text(),/私有请求未能完成/);assert.doesNotMatch(ui.text(),/The private request could not finish|REMOTE_PRIVATE_YNX_ENGLISH/);await ui.update({locale:'en'});assert.match(ui.text(),/The private request could not finish/);}finally{await ui.unmount();}
});
