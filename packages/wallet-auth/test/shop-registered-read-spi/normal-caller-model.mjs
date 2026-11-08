import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFile} from 'node:fs/promises';import {types} from 'node:util';import assert from 'node:assert/strict';
const source=await readFile(new URL('../../src/original-shop-registered-read-normal-private.js',import.meta.url),'utf8');
async function module(image){const ctx=createContext({Promise,Error,Object,Reflect,WeakMap});const m=new SourceTextModule(source,{context:ctx});await m.link(async name=>{const exports=name==='node:util'?{types}:{loadOriginalAuthIdentityNativeImage:()=>image};const d=new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context:ctx});return d;});await m.evaluate();return m.namespace;}
let passed=0;
{
 let resolve,calls=0,init=0;const parent={},read={},partial={};const m=await module({prepareOriginalShopV4Namespace(p){assert.equal(p,parent);calls++;return new Promise(r=>resolve=r);},initializeOriginalShopV4ReadSlot(p,r){assert.equal(p,parent);assert.equal(r,read);init++;return {owner:partial,errorPresent:true,error:0};}});
 const a=m.initializeOriginalShopRegisteredReadForProductSource(parent,read),b=m.initializeOriginalShopRegisteredReadForProductSource(parent,read);assert.equal(a,b);await Promise.resolve();assert.equal(init,0);resolve();const outcome=await a;assert.equal(outcome.owner,partial);assert.equal(outcome.errorPresent,true);assert.equal(outcome.error,0);assert.equal(calls,1);assert.equal(init,1);passed++;
}
for(const raw of [0,null,false,undefined]){let calls=0;const m=await module({prepareOriginalShopV4Namespace(){return Promise.reject(raw)},initializeOriginalShopV4ReadSlot(){calls++;}});let present=false,cause;try{await m.initializeOriginalShopRegisteredReadForProductSource({},{});}catch(e){present=true;cause=e;}assert.equal(present,true);assert.equal(cause,raw);assert.equal(calls,0);passed++;}
{
 let calls=0;const m=await module({prepareOriginalShopV4Namespace(){calls++;return Promise.resolve();}});await assert.rejects(m.initializeOriginalShopRegisteredReadForProductSource({},{}),/NOT_SUPPLIED/);assert.equal(calls,0);passed++;
}
{
 const m=await module({prepareOriginalShopV4Namespace(){return Promise.resolve();},initializeOriginalShopV4ReadSlot(){return {owner:null,errorPresent:false};}});const p={};await m.initializeOriginalShopRegisteredReadForProductSource(p,{});assert.throws(()=>m.initializeOriginalShopRegisteredReadForProductSource(p,{}),/READ_CHANGED/);passed++;
}
console.log(JSON.stringify({PUBLICCallerCases:passed,NativeBodyExecuted:false,RootAdmission:false}));
