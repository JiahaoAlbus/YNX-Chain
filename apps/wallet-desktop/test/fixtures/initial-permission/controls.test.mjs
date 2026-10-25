import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {EventEmitter} from 'node:events';
import {AccountInitialPermissionKernel,bindAccountInitialPermissionRequest} from './src/original-policy-supplier/account-initial-permission-kernel.mjs';
import * as factory from './src/original-policy-supplier/account-initial-permission.mjs';
import {mockBrand} from './src/desktop-wallet-authority.mjs';
import {BrowserWindow} from 'electron';
import {encodePQRegistrationIntent} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const f=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url))),at=Date.parse('2026-10-25T20:00:00.000Z'),iso=n=>new Date(n).toISOString(),sha=v=>createHash('sha256').update(v).digest('hex');
function request(action='sign'){
 return {version:1,kind:'account-initial',action,purpose:'TX-BATCH',networkId:f.expected.chainId,nativeChainId:'6423',account:f.expected.owner,operationId:'Auth-initial-'+action,origin:'ynx-wallet:local-pq',requestDigest:sha(encodePQRegistrationIntent(f.intent)),intent:{...f.intent},createdAt:iso(at),expiresAt:iso(at+20000),dataOnly:true,bootstrapAdmission:false,...(action==='broadcast'?{originalOperationId:'Original-initial-sign',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash,executionHeight:f.expected.executionHeight}:{})};
}
function fixture(action='sign',opt={}){
 let now=at,hook,readHook,completedHook,closeHook;const r=request(action),counts={read:0,current:0,enter:0,complete:0,retire:0,join:0,close:0};
 const genesis=Buffer.from('PUBLIC TEST GENESIS BYTES, NOT AN ACCEPTED ROOT'),source={genesisBytes:genesis,genesisSHA256:sha(genesis),executionHeight:f.expected.executionHeight,occupancy:{chainId:r.networkId,owner:r.account,executionHeight:f.expected.executionHeight,registered:false,ledgerNonce:'0'},memberBytes:action==='broadcast'?Buffer.from(f.wire,'base64url'):null};
 const packet={request:r,issuedAt:iso(at),expiresAt:iso(at+15000),source};
 const peer={async readOriginal(){counts.read++;if(readHook)await readHook();return packet;},assertCurrent(){counts.current++;if(hook){const h=hook;hook=null;h();}},recheck:()=>opt.recheck?.(),enterOriginal(){counts.enter++;},completeOriginal(){counts.complete++;if(completedHook)completedHook();},assertCompletedCurrent(){if(hook){const h=hook;hook=null;h();}},retire(){counts.retire++;},join(){counts.join++;},close(){counts.close++;if(closeHook)closeHook();}};
 const kernel=new AccountInitialPermissionKernel(r,peer,()=>now);
 return {kernel,r,source,packet,peer,counts,advance:n=>{now+=n;},setHook:h=>{hook=h;},setRead:h=>{readHook=h;},setCompleted:h=>{completedHook=h;},setClose:h=>{closeHook=h;}};
}
for(const action of ['sign','broadcast'])test(`independent initial ${action} binds sole SDK42 E15/full pair/Genesis/same-H and enters only once`,async()=>{
 const h=fixture(action);await h.kernel.initialize();assert.equal(h.kernel.readOriginal().intent.ledgerNonce,'1');assert.equal(h.kernel.readOriginal().source.occupancy.ledgerNonce,'0');assert.equal(h.kernel.outcome().permissionFactoryBranded,false);
 const original=Buffer.from(h.source.genesisBytes);h.source.genesisBytes.fill(0);const copy=h.kernel.copyOriginalGenesisBytes();assert.deepEqual(Buffer.from(copy),original);copy.fill(0);assert.deepEqual(Buffer.from(h.kernel.copyOriginalGenesisBytes()),original);
 action==='sign'?h.kernel.enterSign():h.kernel.enterBroadcast();h.kernel.complete({outcome:'returned',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash});assert.equal(h.counts.enter,1);assert.equal(h.counts.complete,1);assert.throws(()=>action==='sign'?h.kernel.enterSign():h.kernel.enterBroadcast());assert.equal(h.counts.enter,1);await h.kernel.close();
});
test('ordinary DTOs/policies/extra fields and accessors cannot become initial permission',()=>{
 for(const edit of [r=>{r.transfer={};},r=>{r.activePolicy={};},r=>{r.intent.priorRevision='1';},r=>{r.intent.ledgerNonce='2';},r=>{r.intent.newRevision='2';},r=>{r.intent.pkB='00';},r=>{r.intent.owner='0x'+'00'.repeat(20);},r=>{r.requestDigest='00'.repeat(32);},r=>{r.bootstrapAdmission=true;}]){const r=request();edit(r);assert.throws(()=>bindAccountInitialPermissionRequest(r));}
 let reads=0;const r=request();Object.defineProperty(r,'intent',{enumerable:true,get(){reads++;throw Error('getter');}});assert.throws(()=>bindAccountInitialPermissionRequest(r));assert.equal(reads,0);
 assert.throws(()=>bindAccountInitialPermissionRequest(new Proxy(request(),{})));
});
test('independent Genesis pin, occupied owner, original H and future activation fail closed',async()=>{
 for(const edit of [h=>{h.source.genesisSHA256='00'.repeat(32);},h=>{h.source.occupancy.registered=true;},h=>{h.source.occupancy.ledgerNonce='1';},h=>{h.source.occupancy.executionHeight='999';},h=>{h.source.executionHeight=h.r.intent.activateAt;},h=>{h.source.occupancy.owner='0x'+'00'.repeat(20);},h=>{h.source.memberBytes=Buffer.from([1]);},h=>{delete h.packet.source;}]){const h=fixture();edit(h);await assert.rejects(h.kernel.initialize());assert.equal(h.counts.enter,0);await h.kernel.close();assert.equal(h.counts.close,1);}
});
test('broadcast validates actual original Member AND signatures/dual hash and never rewrites original H',async()=>{
 for(const edit of [h=>{h.r.transportHash='0x'+'00'.repeat(32);},h=>{h.r.abciTransactionHash='0x'+'00'.repeat(32);},h=>{h.source.memberBytes[100]^=1;},h=>{h.source.executionHeight='2';h.source.occupancy.executionHeight='2';},h=>{h.r.originalOperationId=h.r.operationId;}]){const h=fixture('broadcast');edit(h);await assert.rejects(h.kernel.initialize());assert.equal(h.counts.enter,0);await h.kernel.close();}
});
test('pre/post clock fences reject expiry during original, current and completed callback',async()=>{
 for(const boundary of ['original','current','completed']){
  const h=fixture();if(boundary==='original')h.setRead(()=>h.advance(16000));
  if(boundary==='original')await assert.rejects(h.kernel.initialize());
  else{await h.kernel.initialize();if(boundary==='current'){h.setHook(()=>h.advance(16000));assert.throws(()=>h.kernel.enterSign());assert.equal(h.counts.enter,0);}else{h.kernel.enterSign();h.setCompleted(()=>h.advance(16000));assert.throws(()=>h.kernel.complete({outcome:'returned',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash}));assert.equal(h.kernel.outcome().result.transportHash,f.transportHash);}}
  await h.kernel.close();
 }
});
test('sign and broadcast are separate approvals; wrong action cannot enter',async()=>{
 for(const action of ['sign','broadcast']){const h=fixture(action);await h.kernel.initialize();assert.throws(()=>action==='sign'?h.kernel.enterBroadcast():h.kernel.enterSign());assert.equal(h.counts.enter,0);await h.kernel.close();}
});
test('close-selected fences same tick, pending recheck and close from peer current',async()=>{
 for(const action of ['sign','broadcast']){const h=fixture(action);await h.kernel.initialize();const p=h.kernel.close();assert.throws(()=>action==='sign'?h.kernel.enterSign():h.kernel.enterBroadcast());assert.equal(h.counts.enter,0);assert.equal(h.kernel.close(),p);await p;assert.equal(h.counts.close,1);}
 const h=fixture();await h.kernel.initialize();let close;h.setHook(()=>{close=h.kernel.close();});assert.throws(()=>h.kernel.enterSign());await close;assert.equal(h.counts.enter,0);
 let done,started;const wait=new Promise(r=>{done=r;}),ready=new Promise(r=>{started=r;});const p=fixture('sign',{recheck(){started();return wait;}});await p.kernel.initialize();const checking=p.kernel.recheck(),rejected=assert.rejects(checking);await ready;const closing=p.kernel.close();done();await rejected;await closing;assert.equal(p.counts.join,1);assert.equal(p.counts.close,1);
});
test('retained unknown and false first-close result stay exact without retry',async()=>{
 const h=fixture();await h.kernel.initialize();h.kernel.enterSign();assert.throws(()=>h.kernel.complete({outcome:'unknown',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash}));const result=h.kernel.outcome().result;await h.kernel.close();assert.equal(h.kernel.outcome().result,result);assert.equal(h.kernel.outcome().effectRetryAuthorized,false);
 const p=fixture();await p.kernel.initialize();p.setClose(()=>{throw false;});const closing=p.kernel.close();await assert.rejects(closing,e=>e===false);assert.equal(p.kernel.close(),closing);assert.equal(p.kernel.outcome().cleanupCause,false);assert.equal(p.counts.close,1);
});
function ipc(h,action='sign'){
 const sender=new EventEmitter(),frame={url:new URL('./src/index.html',import.meta.url).href};sender.mainFrame=frame;sender.isDestroyed=()=>false;
 const window={isDestroyed:()=>false};BrowserWindow.mockSet(sender,window);const event={sender,senderFrame:frame};
 const borrow={...h.peer,readApprovalIdentity:()=>({kind:'pq-account-initial',action,operationId:h.r.operationId,reviewId:'PUBLIC-initial-review'})};mockBrand(borrow);
 return{sender,event,borrow,capsule:factory.captureOriginalWalletAccountInitialApprovalIPC(event,'PUBLIC-initial-review',action)};
}
async function withClock(fn){const old=Date.now;Date.now=()=>at;try{return await fn();}finally{Date.now=old;}}
test('actual Main-only producer consumes independent mock Electron event and initial borrow into private brand',()=>withClock(async()=>{
 const h=fixture(),p=ipc(h),owner=await factory.acquireOriginalWalletAccountInitialPermission(h.r,p.capsule,p.borrow);assert.equal(factory.isOriginalWalletAccountInitialPermission(owner),true);owner.enterSign();owner.complete({outcome:'returned',transportHash:f.transportHash,abciTransactionHash:f.abciTransactionHash});await owner.close();assert.equal(h.counts.close,1);assert.equal(p.sender.listenerCount('destroyed'),0);
}));
test('factory rejects fake/ordinary capsule and unbranded borrow; real partial custody is retained on failure',()=>withClock(async()=>{
 const h=fixture(),p=ipc(h);let error;
 try{await factory.acquireOriginalWalletAccountInitialPermission(h.r,{},p.borrow);}catch(e){error=e;}assert(error?.partial);assert.equal(h.counts.close,0);await error.partial.close();assert.equal(h.counts.close,1);assert.equal(factory.isOriginalWalletAccountInitialPermission(error.partial),false);factory.retireUnusedOriginalWalletAccountInitialApproval(p.capsule);
 const h2=fixture(),p2=ipc(h2);await assert.rejects(factory.acquireOriginalWalletAccountInitialPermission(h2.r,p2.capsule,{...p2.borrow}),e=>e.code==='AUTH_WALLET_INITIAL_PERMISSION_NOT_SUPPLIED');assert.equal(h2.counts.read,0);factory.retireUnusedOriginalWalletAccountInitialApproval(p2.capsule);
}));
test('producer duplicate adoption does not steal or close original borrow/capsule',()=>withClock(async()=>{
 const h=fixture(),p=ipc(h),owner=await factory.acquireOriginalWalletAccountInitialPermission(h.r,p.capsule,p.borrow);let duplicate;
 await assert.rejects(factory.acquireOriginalWalletAccountInitialPermission(h.r,p.capsule,p.borrow),e=>{duplicate=e.partial;return true;});await duplicate.close();assert.equal(h.counts.close,0);owner.assertCurrent();await owner.close();assert.equal(h.counts.close,1);
}));
test('navigation revokes same producer and failed factory reports same original partial',()=>withClock(async()=>{
 const h=fixture(),p=ipc(h);p.sender.emit('did-start-navigation');let partial;await assert.rejects(factory.acquireOriginalWalletAccountInitialPermission(h.r,p.capsule,p.borrow),e=>{partial=e.partial;return true;});await partial.close();assert.equal(h.counts.enter,0);assert.equal(h.counts.close,1);assert.equal(p.sender.listenerCount('destroyed'),0);
}));
test('initial identity cannot substitute ordinary review kind or operation',()=>withClock(async()=>{
 for(const kind of ['pq-transfer','pq-account-initial']){const h=fixture(),p=ipc(h);p.borrow.readApprovalIdentity=()=>({kind,action:'sign',operationId:kind==='pq-transfer'?h.r.operationId:'wrong',reviewId:'PUBLIC-initial-review'});let partial;await assert.rejects(factory.acquireOriginalWalletAccountInitialPermission(h.r,p.capsule,p.borrow),e=>{partial=e.partial;return true;});await partial.close();assert.equal(h.counts.read,0);assert.equal(h.counts.close,1);}
}));
