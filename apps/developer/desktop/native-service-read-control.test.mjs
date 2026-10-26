import test from 'node:test';import assert from 'node:assert/strict';import {PassThrough} from 'node:stream';
import {createNativeParentControl} from './native-parent-control.mjs';import {createNativeServiceReadControl} from './native-service-read-control.mjs';
const instance='11111111-2222-4333-8444-555555555555',rid='22222222-3333-4444-8555-666666666666',other='33333333-4444-4555-8666-777777777777';
const context={id:other,workspace:'/PUBLIC/workspace'};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(t,timeoutMs=100){
 const input=new PassThrough(),control=createNativeParentControl({input}),frames=[];
 const owner=createNativeServiceReadControl({control,instance,context,timeoutMs,output:{write(raw,callback){assert.ok(raw.startsWith('@YNX_NATIVE_SERVICE_READ_V1:'));frames.push(JSON.parse(raw.slice(raw.indexOf(':')+1)));callback?.();return true;}}});
 const reply=(frame,value,extra={})=>input.write(Buffer.from(JSON.stringify({action:'native-service-read-result',id:frame.id,instance:frame.instance,projectId:frame.projectId,workspace:frame.workspace,requestId:frame.requestId,ok:true,value,...extra})+'\n'));
 t.after(()=>{owner.close();control.close();input.destroy();});return{owner,control,frames,reply};
}
test('opening alone sends nothing; fixed storage keys and close use the same actual pipe',async t=>{
 const f=fixture(t),o=f.owner.open(rid);assert.equal(f.frames.length,0);
 await assert.rejects(o.get('foreign'));assert.equal(f.frames.length,0);
 const p=o.context();assert.equal(f.frames.length,1);assert.deepEqual(f.frames[0].input,{operation:'context'});f.reply(f.frames[0],{public:'DATA'});assert.deepEqual(await p,{public:'DATA'});
 const end=o.close();f.reply(f.frames[1],true);await end;assert.equal(f.frames[1].input.operation,'close');assert.equal(o.close(),end);f.owner.open(other);
});
test('responses cannot substitute project, launch or request and extra fields are not accepted',async t=>{
 const f=fixture(t),o=f.owner.open(rid);let settled=false;const p=o.context().then(v=>{settled=true;return v;});const row=f.frames[0];
 f.reply(row,'foreign',{projectId:rid});f.reply(row,'foreign',{instance:other});f.reply(row,'foreign',{requestId:other});f.reply(row,'foreign',{approved:true});await tick();assert.equal(settled,false);
 f.reply(row,'actual');assert.equal(await p,'actual');
});
test('timeout never replays sign and UNKNOWN close prevents replacement',async t=>{
 const f=fixture(t,10),o=f.owner.open(rid);
 await assert.rejects(o.sign({purpose:'http-proof',payload:'PUBLIC'}));assert.equal(f.frames.length,1);
 const end=o.close();await assert.rejects(end);assert.equal(f.frames.length,2);await assert.rejects(o.close());assert.equal(f.frames.length,2);
 assert.throws(()=>f.owner.open(other));f.reply(f.frames[1],true);await tick();assert.throws(()=>f.owner.open(other));
});
test('parent retirement rejects pending work without taking another consumer ownership',async t=>{
 const f=fixture(t),o=f.owner.open(rid);const p=o.context(),rejected=assert.rejects(p);
 f.control.close();await rejected;await assert.rejects(o.context());assert.equal(f.frames.length,1);
});
test('per-read close cannot let an already queued result revive the caller',async t=>{
 const f=fixture(t),o=f.owner.open(rid),p=o.context(),rejected=assert.rejects(p);const end=o.close();
 f.reply(f.frames[1],true);await end;f.reply(f.frames[0],{late:true});await rejected;
 assert.equal(f.frames.length,2);f.owner.open(other);
});
test('parallel owners and malformed native request IDs cannot dispatch',async t=>{
 const f=fixture(t);assert.throws(()=>f.owner.open('invalid'));f.owner.open(rid);assert.throws(()=>f.owner.open(other));assert.equal(f.frames.length,0);
});
