import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PQ_CONNECTION_METHODS,captureWalletPQConnection,readWalletPQConnection} from '../src/wallet-pq-connection-contract.mjs';
const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
const start=main.indexOf('async function drainWalletConnectInbox()'),end=main.indexOf('\nasync function terminateWalletConnectReview(',start);
assert.ok(start>0&&end>start);
function fixture(){
 const account='0x'+'ab'.repeat(20),origin='https://ide.example',entry={key:'["original-topic",1]',account,origin,sessionBinding:'PUBLIC exact approved namespace',event:{topic:'original-topic',id:1},stage:'received'};
 const authorized={origin,method:'ynx_preparePQContractAction',params:[{version:1,account}],topic:'original-topic',jsonRpcId:1,sessionBinding:entry.sessionBinding};
 let live=true,calls=0,authorizations=0,captured;const events=[],terminated=[],finished=[],requests=new Map();
 const context={PQ_CONNECTION_METHODS,captureWalletPQConnection,drainingWalletConnectInbox:false,accountChangeInProgress:false,
  keyAccess:{status:()=>({locked:false,authenticating:false,account}),async run(action){return action({assert(){},deliver:fn=>fn()})}},
  walletConnectInbox:{pending:()=>[entry],assertLive(e){if(!live||e!==entry)throw Error('ORIGINAL_INBOX_ENDED')},stage(e,id){e.requestId=id;e.stage='review'},get:()=>entry,finish:key=>{finished.push(key);return entry}},
  walletConnect:{authorizeRequest(){authorizations++;return authorized}},
  walletAuthority:{async accountStatus(){return {account}},async request(input,connection){calls++;captured=connection;assert.equal(readWalletPQConnection(connection).origin,origin);return {status:'approval-required',request:{id:'original-review'}}}},
  walletConnectRequests:requests,mainWindow:{webContents:{send:(...args)=>events.push(args)}},safeCode:e=>e.message,
  async terminateWalletConnectReview(e,code){terminated.push({key:e.key,code});return true}};
 const run=runInNewContext(main.slice(start,end)+';drainWalletConnectInbox;',context);
 return {run,entry,authorized,events,requests,terminated,finished,get calls(){return calls},get authorizations(){return authorizations},get captured(){return captured},end(){live=false}};
}
test('actual Main inbox path passes request-scoped branded connection and stages ordinary Wallet approval without signing',async()=>{
 const f=fixture();await f.run();assert.equal(f.calls,1);assert.ok(f.authorizations>=3);assert.equal(f.entry.stage,'review');assert.equal(f.requests.get('original-review').entryKey,f.entry.key);assert.equal(f.events[0][0],'wallet:provider-request');
 f.end();assert.throws(()=>readWalletPQConnection(f.captured),/ORIGINAL_INBOX_ENDED/);
});
test('actual Main inbox path rejects a changed namespace before admitting a contract request',async()=>{
 const f=fixture();f.authorized.sessionBinding='changed';
 await f.run();assert.equal(f.calls,0);assert.equal(f.events.length,0);assert.deepEqual(f.finished,[f.entry.key]);assert.equal(f.terminated[0].code,'WalletConnect session changed');
});
