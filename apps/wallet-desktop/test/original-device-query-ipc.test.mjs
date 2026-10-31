import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
function fixture(){
 const handlers=new Map(),calls=[],request={version:'4',deviceId:'PUBLIC-original-device'},review={request,account:'PUBLIC-account',loadingAccount:false};
 const context={handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),originalDeviceQuery:{queryOriginal(original){calls.push(original);return {authority:false};}},authorizationController:{pending:review},accountChangeInProgress:false,keyAccess:{status:()=>({account:'PUBLIC-account'})},Object,Error};
 const from=source.indexOf("handleWalletIPC('wallet:query-original-device'"),to=source.indexOf("handleWalletIPC('wallet:cancel-device-create'",from);assert(from>=0&&to>from);runInNewContext(source.slice(from,to),context);return {context,calls,request,handler:handlers.get('wallet:query-original-device')};
}
test('actual Main query uses only the independently retained app request and refuses renderer replacement',async()=>{
 const f=fixture();assert.equal((await f.handler({})).authority,false);assert.equal(f.calls[0],f.request);
 await assert.rejects(f.handler({}, {version:'4',deviceId:'replacement'}),e=>e.code==='DEVICE_QUERY_ZERO_INPUT');assert.equal(f.calls.length,1);
 for(const modify of [c=>{c.authorizationController.pending=null;},c=>{c.authorizationController.pending.loadingAccount=true;},c=>{c.authorizationController.pending.account='other';},c=>{c.accountChangeInProgress=true;}]){const x=fixture();modify(x.context);await assert.rejects(x.handler({}),e=>e.code==='DEVICE_QUERY_ORIGINAL_REQUEST_REQUIRED');assert.equal(x.calls.length,0);}
});
test('preload query sends no terms, identity, account or factory from the renderer',()=>{
 const calls=[];let api;runInNewContext(readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 api.queryOriginalDevice({identity:'replacement'});assert.deepEqual(calls,[['wallet:query-original-device']]);
});
