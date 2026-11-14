import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransactionSubmission} from './submission.mjs';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const row=vector.originals.find(x=>x.name==='transfer-lost-response'),account=vector.owner,networkId=vector.networkId;
const original=createPQOriginalRecord({account,kind:'pq-transfer',operationId:'QA-feature-original',request:preparePQTransferTransport(Buffer.from(row.wire,'base64'))});
const packet=name=>{const r=vector.http.find(x=>x.name===name);return {status:r.statusCode,text:Buffer.from(r.bodyWire,'base64').toString('utf8')};};
const unknown=packet('transfer-outcome-unknown'),inclusion=packet('transfer-original-reconciled');
// Real original SDK codec and durable journal, with CONTROLLED peer/transport.
// Does not attest a real Auth approval, network transaction, or installed App.
async function setup(t,options={}){
 const directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-feature-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,'journal.json');
 let armed=false,writes=0;const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){writes++;throw Error('QA_MARKER_ACK_LOST');}}};
 const store=new FileTransactionIntentStore({filePath,io});await store.reserveOriginal(account,'pq-transfer');store.captureOriginal(account,original,'pq-transfer');await store.saveOriginal(account,original.hash,()=>{});
 let current=true,effect=false,posts=0,gets=0,acquisitions=0,entries=0,completions=0,closes=0;const recognized=new WeakSet();
 const guard={account,assert(){if(!current||effect)throw Error('QA_LOCKED');},assertEffectCurrent(){if(!current)throw Error('QA_LOCKED');},async submit(fn){this.assert();effect=true;return fn();}};
 const acquire=async request=>{acquisitions++;const bound=Object.freeze({...request,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+30000).toISOString()});const resource={readOriginal:()=>bound,assertCurrent(){if(options.permissionFails)throw Error('QA_REVOKED');},async recheck(){if(options.permissionFails)throw Error('QA_REVOKED');},enterBroadcast(){entries++;if(options.enterFails)throw Error('QA_REVOKED');},complete(){completions++;},retire(){},async join(){},async close(){closes++;}};recognized.add(resource);return resource;};
 const transport={async submitTransfer(request){posts++;assert.equal((await new FileTransactionIntentStore({filePath}).readPQProgress(account,original.hash,()=>{})).status,'submission-unknown');assert.deepEqual(request.body,Buffer.from(original.wire,'base64url'));if(options.lateLock)current=false;if(options.throwPost)throw false;return options.result??unknown;},async readOriginal(hash){gets++;assert.equal(hash,original.hash);return inclusion;}};
 const create=(s=store,extra={})=>createPQTransactionSubmission({intentStore:s,networkId,acquireOriginalWalletTransactionPermission:acquire,isOriginalWalletTransactionPermission:x=>recognized.has(x),transport,...extra});
 return {store,filePath,guard,create,lock:()=>{current=false;},arm:()=>{armed=true;},counts:()=>({posts,gets,acquisitions,entries,completions,closes,writes}),freshGuard:()=>({account,assert(){},assertEffectCurrent(){},submit:fn=>fn()})};
}
test('one approved effect writes durable UNKNOWN before POST; duplicate and restart never POST again',async t=>{
 const f=await setup(t),controller=f.create();const result=await controller.broadcast(original.hash,f.guard);assert.equal(result.status,'submission-unknown');assert.equal(f.counts().posts,1);
 await assert.rejects(controller.broadcast(original.hash,f.freshGuard()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});
 const cold=f.create(new FileTransactionIntentStore({filePath:f.filePath}));await assert.rejects(cold.broadcast(original.hash,f.freshGuard()),{code:'PQ_TRANSACTION_ALREADY_ENTERED'});assert.equal(f.counts().posts,1);
 const read=await cold.reconcile(original.hash,f.freshGuard());assert.equal(read.status,'inclusion-observed');assert.equal(read.consensusFinality,false);assert.equal(f.counts().gets,1);assert.equal(f.counts().posts,1);
 assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQOriginals(account,()=>{}))[0].wire,original.wire);
});
test('missing real peer and revoked permission never mark or submit',async t=>{
 const f=await setup(t,{permissionFails:true});await assert.rejects(f.create({ ...f.store },{acquireOriginalWalletTransactionPermission:null}).broadcast(original.hash,f.guard),{code:'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED'});
 await assert.rejects(f.create().broadcast(original.hash,f.guard));assert.equal(f.counts().posts,0);assert.equal((await f.store.readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');
});
test('marker lost acknowledgement preserves same UNKNOWN and calls neither enter nor POST',async t=>{
 const f=await setup(t);f.arm();await assert.rejects(f.create().broadcast(original.hash,f.guard));assert.equal(f.counts().posts,0);assert.equal(f.counts().entries,0);assert.equal(f.counts().writes,1);
 assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(account,original.hash,()=>{})).status,'submission-unknown');
});
test('late lock saves returned result before lifecycle refusal',async t=>{
 const f=await setup(t,{lateLock:true,result:inclusion});await assert.rejects(f.create().broadcast(original.hash,f.guard));
 const progress=await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(account,original.hash,()=>{});assert.equal(progress.status,'inclusion-observed');assert.equal(progress.consensusFinality,false);assert.equal(f.counts().posts,1);assert.equal(f.counts().completions,1);
});
test('transport UNKNOWN preserves falsy first cause, closes peer once, and read never signs or resends',async t=>{
 const f=await setup(t,{throwPost:true}),controller=f.create();await assert.rejects(controller.broadcast(original.hash,f.guard),{code:'PQ_TRANSACTION_OUTCOME_UNKNOWN'});
 const p=await f.store.readPQProgress(account,original.hash,()=>{});assert.equal(p.status,'submission-unknown');assert.deepEqual(p.firstCause,{kind:'boolean',value:false,code:null});assert.equal(f.counts().closes,1);
 await controller.reconcile(original.hash,f.freshGuard());assert.equal(f.counts().posts,1);assert.equal(f.counts().gets,1);
});
test('read of signed-only original does not create a submission marker or claim a broadcast',async t=>{
 const f=await setup(t);await assert.rejects(f.create().reconcile(original.hash,f.guard),{code:'PQ_TRANSACTION_NOT_ENTERED'});assert.equal(f.counts().gets,0);assert.equal((await f.store.readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');
});

// PUBLIC synthetic IPC/transport: no real account, signing, POST or finality.
test('PUBLIC original UNKNOWN normal renderer -> Main query -> cold journal updates same hash without POST',async t=>{
 assert.equal(vector.syntheticOnly,true);assert.equal(vector.actualCometNode,false);assert.equal(vector.independentFinality,false);
 const {runInNewContext}=await import('node:vm'),{projectPendingTransactions}=await import('../../transaction-resolution-display.mjs'),{appendPQBroadcastActions}=await import('../../wallet-pq-broadcast-ui.mjs'),{TransactionSubmissions}=await import('../../transaction-submissions.mjs');
 const f=await setup(t);await f.store.beginPQSubmission(account,original.hash,()=>{});
 const cold=new FileTransactionIntentStore({filePath:f.filePath}),controller=f.create(cold),guard=f.freshGuard(),submissions=new TransactionSubmissions({intentStore:cold});
 const main=await fs.readFile(new URL('../../main.mjs',import.meta.url),'utf8'),start=main.indexOf('async function safeIPC('),end=main.indexOf('function safeErrorClass(',start),sensitive=main.match(/^const sensitiveIPC = .*;$/m)?.[0],line=main.match(/^handleWalletIPC\('wallet:pq-submission-query'.*$/m)?.[0],handlers=new Map();assert(sensitive&&line);
 const keyAccess={current:()=>guard,run:async action=>action()};runInNewContext(main.slice(start,end)+'\n'+sensitive+'\n'+line,{keyAccess,pqTransactionSubmission:controller,handleWalletIPC:(name,fn)=>handlers.set(name,fn)});
 const query=hash=>handlers.get('wallet:pq-submission-query')(null,hash),source=await fs.readFile(new URL('../../renderer.js',import.meta.url),'utf8'),a=source.indexOf('async function refreshTransactions()'),b=source.indexOf('\ndocument.querySelector("#refresh-pending-transactions")',a),nodes=new Map();
 class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.listeners={};this.textContent='';this.disabled=false;this.hidden=false;}append(...v){this.children.push(...v)}replaceChildren(...v){this.children=v}addEventListener(name,fn){this.listeners[name]=fn}}
 const doc={querySelector(name){if(!nodes.has(name))nodes.set(name,new Element(doc));return nodes.get(name)},createElement(){return new Element(doc)}};
 const api={pendingTransactions:async()=>({ok:true,value:await submissions.list(account)}),queryPQSubmission:async hash=>structuredClone(await query(hash))};
 const context={document:doc,window:{ynxWallet:api},activeAccount:account,transactionRevision:0,transactionActionRevision:0,keyState:{account,revision:1,locked:false,authenticating:false},projectPendingTransactions,appendPQOriginalRecoveryActions(){},appendPQProgressActions(){},appendPQBroadcastActions:options=>appendPQBroadcastActions({...options,document:doc}),copyUI:(node,text)=>node.textContent=text};
 runInNewContext(source.slice(a,b),context);await context.refreshTransactions();const row=nodes.get('#pending-transactions').children[0],button=row.children.find(n=>n.textContent.includes('Query the same PQ submission'));assert(button);
 await button.listeners.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts().gets,1);assert.equal(f.counts().posts,0);assert.equal(f.counts().acquisitions,0);
 const progress=await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(account,original.hash,()=>{});assert.equal(progress.status,'inclusion-observed');assert.equal(progress.consensusFinality,false);assert.equal(progress.retryAuthorized,false);assert.equal((await cold.readPQOriginals(account,()=>{}))[0].wire,original.wire);assert.match(nodes.get('#pending-transactions').children[0].children[1].textContent,/Inclusion of the same original observed/);
});
