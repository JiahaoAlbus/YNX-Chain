import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
function fixture({lateLock=false,publishFailure=false}={}){
 const handlers=new Map(),events=[],expired=[],account='0x'+'11'.repeat(20);let pq=0,classic=0,current=true;
 const guard={account,assert(){if(!current)throw Error('LOCKED');}};
 const context={normalizeWalletPQTransferInput:input=>input,handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:async action=>action(),keyAccess:{current:()=>guard},mainWindow:{isDestroyed:()=>false,webContents:{send(...args){if(publishFailure)throw Error('WINDOW_CLOSED');events.push(args);}}},walletAuthority:{async requestPQTransfer(input){pq++;if(lateLock)current=false;return {status:'approval-required',request:{id:'original-pq-review',method:'ynx_signPQNativeTransfer',review:{account},input}};},expire:id=>expired.push(id)},nativeWallet:{async prepareTransfer(){classic++;return {id:'CLASSIC'};},beginTransferAttempt(){classic++;},async transferAction(){classic++;return {hash:'CLASSIC'};},finishTransferAttempt(){}},Object,Error};
 const helperStart=source.indexOf('async function prepareLocalPQTransferReview('),helperEnd=source.indexOf("handleWalletIPC('wallet:pq-transfer-review'",helperStart);
 if(helperStart>=0)runInNewContext(source.slice(helperStart,helperEnd),context);
 const start=source.indexOf('handleWalletIPC("wallet:prepare-transfer"'),end=source.indexOf('handleWalletIPC("wallet:transfer-attempts"',start);assert(start>=0&&end>start);runInNewContext(source.slice(start,end),context);
 return {handlers,events,expired,account,get pq(){return pq},get classic(){return classic}};
}
test('actual default Main transfer IPC selects existing PQ review and never calls classic signer or submits',async()=>{
 const f=fixture(),r=await f.handlers.get('wallet:prepare-transfer')({}, {to:'ynx1PUBLIC',amount:'3'});assert.equal(f.classic,0);assert.equal(f.pq,1);assert.equal(r.protocol,'YNX-BATCH/v0.1');assert.equal(r.requestId,'original-pq-review');assert.equal(r.account,f.account);assert.equal(r.submitted,false);assert.equal(r.signed,false);assert.equal(f.events[0][0],'wallet:provider-request');
});
test('late lock and failed delivery cancel the original pending PQ review, with no classic fallback',async()=>{
 for(const options of [{lateLock:true},{publishFailure:true}]){const f=fixture(options);await assert.rejects(f.handlers.get('wallet:prepare-transfer')({}, {to:'ynx1PUBLIC',amount:'3'}));assert.deepEqual(f.expired,['original-pq-review']);assert.equal(f.classic,0);assert.equal(f.pq,1);assert.equal(f.events.length,0);}
});
test('legacy local approve route cannot reach ECC signing after default PQ transition',async()=>{
 const f=fixture();await assert.rejects(f.handlers.get('wallet:transfer-action')({},'old-review','approve'),e=>e.code==='YNX_PQ_REVIEW_REQUIRED');assert.equal(f.classic,0);assert.equal(f.pq,0);assert.equal(f.events.length,0);
});
