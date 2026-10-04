import assert from "node:assert/strict";
import test from "node:test";
import {createRecipientCameraUI} from "../src/recipient-camera-ui.mjs";
test("restart must not dispatch another decode while retired decode remains pending",async()=>{
 const context={open:true,locked:false,focused:true,account:"public-test-input",keyRevision:1,draftRevision:1};
 let active=0,peak=0,starts=0,applied=0,stopped=0; const resolvers=[];
 const camera=createRecipientCameraUI({getContext:()=>context,begin:async()=>({ok:true,value:{id:`local-${++starts}`}}),end:async()=>{},
 openStream:async()=>({getTracks:()=>[{stop(){stopped++},addEventListener(){}}]}),attach:async()=>{},detach(){},
 capture:async()=>({bytes:new ArrayBuffer(1),mimeType:"image/png"}),
 decode:()=>{active++;peak=Math.max(peak,active);return new Promise(resolve=>resolvers.push(value=>{active--;resolve(value)}))},
 apply:async()=>{applied++},report(){},schedule:()=>0,cancel(){},now:()=>0});
 await camera.start();await Promise.resolve();assert.equal(active,1);
 await camera.start();await Promise.resolve();
 const observed={peak,pending:active,starts,stopped,applied};
 camera.stop();for(const resolve of resolvers)resolve({ok:false});await Promise.resolve();
 console.log(JSON.stringify(observed));assert.equal(peak,1,"pending decode is serialized only within one generation, not across explicit restart");
});

const settle = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function restartFixture({pendingCapture = false} = {}) {
 const context = {open:true,locked:false,focused:true,account:"public-test-input",keyRevision:1,draftRevision:1};
 const requests = [], captures = [], streams = [], timers = [], applied = [];
 let clock = 0, active = 0, peak = 0, captureCount = 0;
 const deferred = () => {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject};};
 const camera = createRecipientCameraUI({getContext:()=>context,
  begin:async()=>({ok:true,value:{id:`permit-${streams.length}`}}),end:async()=>{},
  openStream:async()=>{const stream={stopped:0,getTracks:()=>[{stop(){stream.stopped++;},addEventListener(){}}]};streams.push(stream);return stream;},
  attach:async()=>{},detach(){},capture:()=>{captureCount++;if(pendingCapture){const item=deferred();captures.push(item);return item.promise;}return Promise.resolve({bytes:new ArrayBuffer(1),mimeType:"image/png"});},
  decode:()=>{active++;peak=Math.max(peak,active);const item=deferred();requests.push(item);return item.promise.finally(()=>active--);},
  apply:async address=>applied.push(address),report(){},
  schedule:(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},cancel:timer=>{if(timer)timer.cancelled=true;},now:()=>clock});
 return {camera,context,requests,captures,streams,timers,applied,setClock:value=>clock=value,
  counts:()=>({active,peak,captureCount})};
}
const validResult = {ok:true,value:{ynxAccount:"retired-public-input",chainId:"ynx_6423-1",asset:"YNXT"}};

for (const completion of ["resolve", "reject"]) test(`only latest restart resumes after retired decode ${completion}`,async()=>{
 const f=restartFixture();await f.camera.start();await settle();
 for(let i=0;i<20;i++)await f.camera.start();await settle();
 assert.equal(f.requests.length,1);assert.equal(f.counts().captureCount,1);
 assert.equal(f.streams.filter(s=>s.stopped===0).length,1);
 if(completion==="resolve")f.requests[0].resolve(validResult);else f.requests[0].reject(new Error("retired decode"));
 await settle();assert.equal(f.requests.length,2);assert.equal(f.counts().peak,1);assert.deepEqual(f.applied,[]);
 f.camera.stop();f.requests[1].resolve(validResult);await settle();assert.deepEqual(f.applied,[]);
});

test("unresolved frame capture also remains serialized across restart",async()=>{
 const f=restartFixture({pendingCapture:true});await f.camera.start();await f.camera.start();await settle();
 assert.equal(f.captures.length,1);assert.equal(f.requests.length,0);
 f.captures[0].resolve({bytes:new ArrayBuffer(1),mimeType:"image/png"});await settle();
 assert.equal(f.captures.length,2);assert.equal(f.requests.length,0);
 f.captures[1].resolve({bytes:new ArrayBuffer(1),mimeType:"image/png"});await settle();
 assert.equal(f.requests.length,1);f.camera.stop();f.requests[0].resolve({ok:false});await settle();
});

for(const changed of [{open:false},{locked:true},{focused:false},{account:"replacement"},{keyRevision:2},{draftRevision:2}])
 test(`waiting restart never resumes after context change ${JSON.stringify(changed)}`,async()=>{
  const f=restartFixture();await f.camera.start();await f.camera.start();await settle();
  Object.assign(f.context,changed);f.requests[0].resolve(validResult);await settle();
  assert.equal(f.requests.length,1);assert.deepEqual(f.applied,[]);
  assert.equal(f.streams.filter(s=>s.stopped===0).length,0);f.camera.stop();
 });

test("stop removes waiter but does not pretend to cancel the retired decode",async()=>{
 const f=restartFixture();await f.camera.start();await f.camera.start();f.camera.stop();
 await f.camera.start();await settle();assert.equal(f.requests.length,1);assert.equal(f.counts().active,1);
 f.camera.stop();f.requests[0].resolve(validResult);await settle();
 assert.equal(f.requests.length,1);assert.deepEqual(f.applied,[]);
});

test("waiting restart expires even when the retired request never settles",async()=>{
 const f=restartFixture();await f.camera.start();await f.camera.start();await settle();
 f.setClock(60000);const expiry=f.timers.findLast(t=>t.delay===60000&&!t.cancelled);expiry.fn();
 assert.equal(f.streams.filter(s=>s.stopped===0).length,0);assert.equal(f.counts().active,1);
 f.requests[0].resolve(validResult);await settle();assert.equal(f.requests.length,1);assert.deepEqual(f.applied,[]);
});
