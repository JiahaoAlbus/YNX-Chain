// Actual Main class/journal/review code + retained PUBLIC Core Members only.
// No approve(), Native key creation, send, real Source, funds or finality claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createNativePayMainEntry} from '../main-entry.mjs';
const root=process.env.PAY_CLIENT_MAIN_SOURCE,fixtureFile=process.env.PAY_CLIENT_QA_MANIFEST;
if(!path.isAbsolute(root??'')||!path.isAbsolute(fixtureFile??''))throw Error('Explicit original Main source and retained public fixture required.');
const sdk=path.join(root,'packages/wallet-auth'),pkg=JSON.parse(fs.readFileSync(path.join(sdk,'package.json')));
const entry=v=>typeof v==='string'?v:v&&entry(v.node??v.import??v.default);
const namespaces=new Map(Object.entries(pkg.exports).flatMap(([k,v])=>{const target=entry(v);return typeof target==='string'?[['@ynx-chain/wallet-auth'+(k==='.'?'':k.slice(1)),pathToFileURL(path.join(sdk,target)).href]]:[]}));
const sourceFiles=new Map(),hashSource=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
registerHooks({resolve(name,context,next){const result=namespaces.has(name)?{url:namespaces.get(name),shortCircuit:true}:next(name,context);
 if(result.url?.startsWith('file:')){const file=fileURLToPath(result.url);if(file.startsWith(root+path.sep)&&!sourceFiles.has(file))sourceFiles.set(file,hashSource(file));}return result;}});
const mainRoot=path.join(root,'apps/wallet-desktop/src');
const original=relative=>import(pathToFileURL(path.join(mainRoot,relative)).href);
const {DesktopWalletAuthority,MemoryPermissionStore}=await original('desktop-wallet-authority.mjs');
const {DesktopKeyLifecycle}=await original('key-lifecycle.mjs');
const {FileTransactionIntentStore}=await original('transaction-intent-store.mjs');
const {preparePQTypedActionReview}=await original('features/pq-transaction/typed-action-caller.mjs');
const {createPQTypedOriginalFromMember}=await original('wallet-pq-typed-original.mjs');
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const {decodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
const fixture=JSON.parse(fs.readFileSync(fixtureFile)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function policy(view){const p=view.policy,active=p.records.filter(r=>BigInt(r.activeFrom)<=BigInt(view.executionHeight)).at(-1);return {owner:view.owner,executionHeight:view.executionHeight,ledgerNonce:view.ledgerNonce,algorithmVersion:active.algorithmVersion,enabled:view.enabled,records:p.records,policyVersion:p.version,networkId:view.networkId,enableAt:p.enableAt,activeRevision:active.revision,...(p.version==='YNX-ACCOUNT-POLICY/v2'?{revocations:p.revocations}:{})};}
const records=[];
for(const [i,row] of fixture.Rows.entries()){
 const action=decodePQNativeAction(Buffer.from(row.Message,'base64')),data=policy(row.PriorAuthorization),snapshot=parsePQAccountAuthorization(data,{owner:action.owner,chainId:action.chainId,nativeChainId:action.nativeChainId});
 const time=Date.now(),metadata={operationId:'PUBLIC-retained-pay-'+i,account:action.owner,networkId:action.chainId,createdAt:new Date(time).toISOString(),expiresAt:new Date(time+60000).toISOString()};
 let materials=null;
 if(i>0)materials={termsMessage:Buffer.from(fixture.Rows[0].Message,'base64'),settlement:i===2?{review:records[1].typed.review,member:Buffer.from(fixture.Rows[1].Wire,'base64'),original:{reviewSnapshot:parsePQAccountAuthorization(policy(fixture.Rows[1].PriorAuthorization),{owner:records[1].account,chainId:records[1].typed.networkId,nativeChainId:'6423'}),signingSnapshot:parsePQAccountAuthorization(policy(fixture.Rows[1].PriorAuthorization),{owner:records[1].account,chainId:records[1].typed.networkId,nativeChainId:'6423'}),selectedBinding:{account:records[1].account,networkId:records[1].typed.networkId}}}:null};
 const review=preparePQTypedActionReview(snapshot,action,metadata,materials);
 records.push(createPQTypedOriginalFromMember(Buffer.from(row.Wire,'base64'),{review,reviewSnapshot:data,signingSnapshot:data}));
}
const results=[];
for(const [i,record] of records.entries()){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pay-main-normal-')),lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account:record.account}),method:'PUBLIC-controlled-review-only'}});
 let dispatched=0,retired=false;
 try{
  lifecycle.setFocused(true);await lifecycle.unlock();
  const data=policy(fixture.Rows[i].PriorAuthorization),snapshot=parsePQAccountAuthorization(data,{owner:record.account,chainId:record.typed.networkId,nativeChainId:'6423'}),at=Date.now();
  const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:record.typed.networkId,nativeChainId:'6423',canonicalOwner:record.account,authorization:snapshot,observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+60000).toISOString()});
  const resource={assertCurrent(){if(retired)throw Error('PUBLIC-retired')},readOriginal:()=>view,async recheck(){},retire(){retired=true},async join(){},async close(){}};
  const store=new FileTransactionIntentStore({filePath:path.join(directory,'original-main-journal.json')});await store.reserveOriginal(record.account,record.kind);store.captureOriginal(record.account,record,record.kind);await store.saveOriginal(record.account,record.hash,()=>{});
  const main=new DesktopWalletAuthority({vault:{authorization:lifecycle,async status(){return {initialized:true,account:record.account}}},permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqNetworkId:record.typed.networkId,pqPolicySource:async()=>resource,pqPolicyRecognized:value=>value===resource,pqTransactionPermissionSource:async()=>{throw Error('No approval in this test')},pqTransactionPermissionRecognized:()=>false,pqBroadcastSource:async()=>{dispatched++;throw Error('No funds in this test')}});
  const terms=fixture.Terms,merchant=fixture.Merchant,termsHash=sha(Buffer.from(fixture.Rows[0].Message,'base64')),intentId='npi_'+'1'.repeat(48);
  const bill={merchant,invoiceId:terms.InvoiceID,sessionId:terms.SessionID,genesis:record.typed.networkId,nativeChainId:'6423',principalAtoms:'100',termsHash,settlementNativeHash:records[1].typed.memberHash,operations:{[records[1].typed.memberHash]:{member:fixture.Rows[1].Wire}}};
  const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:record.account,revision:lifecycle.status().revision,focused:true,locked:false,changing:false})});
  entry.compose({current(){},pay:{async readInvoice(){return bill},async readInvoiceIntent(){return {merchant,intentId,signingMessageHash:termsHash,request:{sourceOrder:'order-100'}}},async merchantTermsReview(){throw Error('not needed')}}});
  await assert.rejects(lifecycle.run(()=>entry.invoke({action:'broadcast-review',kind:record.typed.review.action.kind,merchant,invoiceId:terms.InvoiceID,intentId,originalHash:record.hash})),{code:'NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE'});
  assert.equal(main.pending.size,0); // generic Core review is not a Pay target
  assert.equal((await store.readPQProgress(record.account,record.hash,()=>{})).status,'signed-unsubmitted');assert.equal(dispatched,0);
  entry.cancel();assert.equal(main.pending.size,0);await main.shutdownPQReviews();
  const cold=new FileTransactionIntentStore({filePath:path.join(directory,'original-main-journal.json')});assert.equal((await cold.readPQOriginals(record.account,()=>{}))[0].hash,record.hash);
  results.push({kind:record.typed.review.action.kind,actualCoreMainPayRefusal:true,originalJournal:true,originalStatus:'signed-unsubmitted',dispatches:dispatched});
 }finally{lifecycle.lock();fs.rmSync(directory,{recursive:true,force:true});}
}
for(const [file,hash] of sourceFiles)assert.equal(hashSource(file),hash,'Actual Main source changed during validation: '+file);
const result={result:'PASS',results,actualMainSource:root,sourceFiles:[...sourceFiles].map(([file,sha256])=>({file,sha256})),fixture:fixtureFile,realSource:false,actualVisibleApproval:false,NativeKeysCreated:false,fundsDispatched:false};
if(process.env.PAY_MAIN_NORMAL_RESULT){assert.ok(path.isAbsolute(process.env.PAY_MAIN_NORMAL_RESULT));fs.writeFileSync(process.env.PAY_MAIN_NORMAL_RESULT,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({...result,sourceFiles:sourceFiles.size}));
