// PUBLIC synthetic namespace + actual SDK C++ body, not Auth/Root qualification.
import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const m=createRequire(import.meta.url)(process.env.PUBLIC_SHOP_SPI_MODEL_ADDON);
const next=()=>new Promise(r=>setImmediate(r));let passed=0;
const result=()=>Object.freeze({proofHeaderName:'x-ynx-product-session-proof-v4',proofHeader:'PUBLIC_header',issuedAtMs:1000,expiresAtMs:2000});
function capture(create,captureFn=(read,scope)=>{assert.equal(scope.version,1);assert.equal(scope.operations[0],'readOriginalInvoiceIntent');return {assertCurrent(){},release(){},readOriginalNativeDeviceSource(){return read;}};}){return m.capture({capture:captureFn,create},{});}
{
 let resolve,calls=0;const r=capture(()=>{calls++;return new Promise(a=>resolve=a)}),p=m.begin(r);
 assert.equal(m.pjoin(p).physicalDone,0);assert.equal(m.pclose(p).physicalDone,0);assert.equal(m.rclose(r).physicalDone,0);
 resolve(result());await next();assert.equal(m.copy(p).header,'PUBLIC_header');assert.equal(m.pjoin(p).physicalDone,1);assert.equal(m.pclose(p).physicalDone,1);assert.equal(m.rclose(r).physicalDone,1);assert.equal(calls,1);passed++;
}
{
 let reject;const r=capture(()=>new Promise((_,b)=>reject=b)),p=m.begin(r);reject(0);await next();
 const q=m.pjoin(p);assert.equal(q.errorPresent,1);assert.equal(q.code,0);assert.equal(q.unknown,1);assert.equal(q.physicalDone,0);
 assert.equal(m.pclose(p).physicalDone,0);assert.equal(m.rclose(r).physicalDone,0);assert.equal(m.pclose(p).physicalDone,0);passed++;
}
{
 const r=capture(()=>Promise.reject(null)),p=m.begin(r);await next();assert.equal(m.pjoin(p).errorPresent,1);assert.equal(m.pjoin(p).unknown,1);assert.equal(m.copy(p).ready,0);passed++;
}
{
 const r=capture(()=>Promise.resolve(result())),p=m.begin(r);await next();m.dropfail(true);const q=m.pclose(p);assert.equal(q.physicalDone,0);assert.equal(q.unknown,1);m.dropfail(false);assert.equal(m.pclose(p).physicalDone,0);passed++;
}
{
 const r=capture(()=>Promise.resolve(result()));const before=m.nscloses();m.dropfail(true);const q=m.rclose(r);assert.equal(q.physicalDone,0);assert.equal(q.unknown,1);m.dropfail(false);assert.equal(m.rclose(r).physicalDone,0);assert.equal(m.nscloses(),before+1);passed++;
}
{
 const q=m.sticky();assert.deepEqual(q,{errorPresent:1,code:0,unknown:1,physicalDone:0});passed++;
}
{
 const r=capture(()=>Promise.resolve(result()),()=>{throw 0;});m.nsunknown(true);const before=m.nscloses();const q=m.rclose(r);assert.equal(q.code,0);assert.equal(q.errorPresent,1);assert.equal(q.unknown,1);assert.equal(q.physicalDone,0);m.rclose(r);assert.equal(m.nscloses(),before+1);m.nsunknown(false);passed++;
}
{
 let effects=0;const r=capture(()=>{effects++;return Promise.resolve({...result(),expiresAtMs:1000});}),p=m.begin(r);await next();assert.equal(m.copy(p).ready,0);assert.equal(m.pjoin(p).physicalDone,1);assert.equal(m.pclose(p).physicalDone,1);assert.equal(m.rclose(r).physicalDone,1);assert.equal(effects,1);passed++;
}
{
 let hostile=0;const promise=Promise.resolve(result());Object.defineProperty(promise,'then',{get(){hostile++;throw Error('OWN_THEN_TRAP');}});const r=capture(()=>promise);const originalThen=Promise.prototype.then;Promise.prototype.then=function(){hostile++;throw Error('PROTOTYPE_THEN_TRAP');};let p;try{p=m.begin(r);}finally{Promise.prototype.then=originalThen;}await next();assert.equal(hostile,0);assert.equal(m.copy(p).ready,1);assert.equal(m.pclose(p).physicalDone,1);assert.equal(m.rclose(r).physicalDone,1);passed++;
}
{
 m.allocfail(0);const r=capture(()=>Promise.resolve(result()));assert.equal(r,null);passed++;
}
{
 let opens=0,closed=0;for(let i=0;i<4100;i++){const r=capture(()=>Promise.resolve(result()));if(!r)break;opens++;if(m.rclose(r).physicalDone===1)closed++;}assert.equal(opens,closed);assert(opens>4000&&opens<4096);assert.equal(capture(()=>Promise.resolve(result())),null);passed++;
}
console.log(JSON.stringify({PUBLICModelCases:passed,actualSDKCPPBody:true,AuthNativeExecuted:false,RootAdmission:false,NativeAdmission:false}));
