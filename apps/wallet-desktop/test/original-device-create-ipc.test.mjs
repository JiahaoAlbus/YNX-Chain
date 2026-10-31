import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
function fixture({publishFails=false,changing=false}={}){
 const handlers=new Map(),calls=[],request=Object.freeze({id:'original-device-create-review',method:'ynx_createProductDevice'});
 const context={handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),safeIPC:fn=>fn(),accountChangeInProgress:changing,keyAccess:{current:()=>({assert(){}})},mainWindow:{isDestroyed:()=>false,webContents:{send(name,value){if(publishFails)throw Error('PUBLIC_DELIVERY_FAILED');calls.push(['publish',name,value.id]);}}},originalDeviceCreation:{async prepareReview(){calls.push(['prepare']);return request;},async rejectOriginal(id){calls.push(['reject',id]);return {phase:'cancelled-before-effect'};},readStatusDATA(){return {phase:'review',requestId:request.id};}},Object,Error};
 const from=source.indexOf("handleWalletIPC('wallet:prepare-device-create'"),to=source.indexOf('async function prepareLocalPQAccountInitialReview',from);assert(from>=0&&to>from);runInNewContext(source.slice(from,to),context);return{handlers,calls,request};
}
test('actual Main device-create IPC takes zero terms and delivers the original request to the normal confirmation queue',async()=>{
 const f=fixture();const result=await f.handlers.get('wallet:prepare-device-create')({});assert.equal(result.requestId,f.request.id);assert.equal(result.phase,'review');assert.deepEqual(f.calls,[['prepare'],['publish','wallet:provider-request',f.request.id]]);
 await assert.rejects(f.handlers.get('wallet:prepare-device-create')({}, {approved:true,account:'different',terms:'different'}),e=>e.code==='DEVICE_CREATE_ZERO_INPUT');assert.equal(f.calls.filter(x=>x[0]==='prepare').length,1);
});
test('actual Main failed device review delivery retires the exact original and changing accounts cannot prepare',async()=>{
 const f=fixture({publishFails:true});await assert.rejects(f.handlers.get('wallet:prepare-device-create')({}),e=>e.code==='DEVICE_CREATE_ORIGINAL_REQUEST_UNAVAILABLE');assert.deepEqual(f.calls,[['prepare'],['reject',f.request.id]]);
 const changing=fixture({changing:true});await assert.rejects(changing.handlers.get('wallet:prepare-device-create')({}));assert.equal(changing.calls.length,0);
});
