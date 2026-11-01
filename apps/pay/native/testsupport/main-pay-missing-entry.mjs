// Actual frozen Core-only P01 Main class and empty original journal.
// New Pay consumer must refuse before any Core review/dispatch.
// No Member, approve, Native key, real Source or funds is created.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createNativePayMainEntry} from '../main-entry.mjs';
const root=process.env.PAY_CLIENT_MAIN_SOURCE;
if(!path.isAbsolute(root??''))throw Error('Explicit original Main source required.');
const sdk=path.join(root,'packages/wallet-auth'),pkg=JSON.parse(fs.readFileSync(path.join(sdk,'package.json')));
const entry=v=>typeof v==='string'?v:v&&entry(v.node??v.import??v.default);
const namespaces=new Map(Object.entries(pkg.exports).flatMap(([k,v])=>{const target=entry(v);return typeof target==='string'?[['@ynx-chain/wallet-auth'+(k==='.'?'':k.slice(1)),pathToFileURL(path.join(sdk,target)).href]]:[]}));
const sourceFiles=new Map(),hashSource=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
registerHooks({resolve(name,context,next){const result=namespaces.has(name)?{url:namespaces.get(name),shortCircuit:true}:next(name,context);
 if(result.url?.startsWith('file:')){const file=fileURLToPath(result.url);if(file.startsWith(root+path.sep)&&!sourceFiles.has(file))sourceFiles.set(file,hashSource(file));}return result;}});
const mainRoot=path.join(root,'apps/wallet-desktop/src');
const original=relative=>import(pathToFileURL(path.join(mainRoot,relative)).href);
const {DesktopWalletAuthority,MemoryPermissionStore}=await original('desktop-wallet-authority.mjs');
const {FileTransactionIntentStore}=await original('transaction-intent-store.mjs');
const directory=fs.mkdtempSync(path.join(process.env.TMPDIR,'pay-main-refusal-'));
let coreCalls=0,payCalls=0;
const account='0x'+'1'.repeat(40),store=new FileTransactionIntentStore({filePath:path.join(directory,'PUBLIC-empty-original-main.json')});
const main=new DesktopWalletAuthority({vault:{async status(){return {initialized:true,account};}},permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqBroadcastSource:async()=>{coreCalls++;throw Error('PUBLIC Core must never be called');}});
try{
 assert.equal(typeof main.requestPQBroadcast,'function');
 assert.equal(typeof main.requestPQPayBroadcast,'undefined','This negative fixture targets the frozen Core-only Main; intake a new qualified caller separately.');
 const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account,revision:1,focused:true,locked:false,changing:false})});
 entry.compose({current(){},pay:{async readInvoice(){payCalls++;throw Error('must not reach Pay before actual Main entry');},async readInvoiceIntent(){payCalls++;throw Error('must not reach Pay before actual Main entry');},async merchantTermsReview(){payCalls++;}}});
 for(const kind of ['invoice_terms','invoice_settle','invoice_refund'])await assert.rejects(entry.invoke({action:'broadcast-review',kind,merchant:account,invoiceId:'invoice-original',intentId:kind==='invoice_terms'?'npi_'+'1'.repeat(48):'',originalHash:'0x'+'2'.repeat(64)}),{code:'NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE'});
 assert.equal(main.pending.size,0);assert.equal(coreCalls,0);assert.equal(payCalls,0);await main.shutdownPQReviews();
 for(const [file,hash] of sourceFiles)assert.equal(hashSource(file),hash,'Actual Main input changed: '+file);
 const result={result:'PASS',actualMainSource:root,actualGenericCoreReviewPresent:true,actualPayReviewAbsent:true,blockedKinds:3,coreDispatches:0,payDispatches:0,pendingReviews:0,actualVisibleApproval:false,NativeKeysCreated:false,RootSupplied:false,sourceFiles:[...sourceFiles].map(([file,sha256])=>({file,sha256}))};
 if(process.env.PAY_MAIN_PAY_REFUSAL_RESULT)fs.writeFileSync(process.env.PAY_MAIN_PAY_REFUSAL_RESULT,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,sourceFiles:sourceFiles.size}));
}finally{fs.rmSync(directory,{recursive:true,force:true});}
