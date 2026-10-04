import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRecipientCameraUI,captureRecipientFrame} from "../src/recipient-camera-ui.mjs";
import {createRecipientCameraPermission} from "../src/recipient-camera-permission.mjs";
import {CAMERA_COPY} from "../src/wallet-locale-camera.mjs";
import {WALLET_LOCALES,walletCopy} from "../src/wallet-locale.mjs";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(overrides={}) {
  let time=0;const context={open:true,locked:false,focused:true,account:"public-original",keyRevision:2,draftRevision:3};
  const events=[],timers=[],stream={getTracks:()=>[{stop:()=>events.push("track-stop")}]};
  const ui=createRecipientCameraUI({getContext:()=>({...context}),begin:async()=>({ok:true,value:{id:"original-permit"}}),
    end:async id=>events.push(["end",id]),openStream:async()=>stream,attach:async()=>events.push("attach"),detach:()=>events.push("detach"),
    capture:async()=>({bytes:new ArrayBuffer(1),mimeType:"image/png"}),decode:async()=>({ok:false}),apply:async address=>events.push(["apply",address]),report:copy=>events.push(["report",copy]),
    schedule:(fn,delay)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},cancel:timer=>{if(timer)timer.cancelled=true;},now:()=>time,...overrides});
  return {ui,context,events,timers,stream,setTime:value=>{time=value;}};
}
test("construction does not request any camera or permission; explicit start does",async()=>{
  const h=fixture();assert.deepEqual(h.events,[]);await h.ui.start();await tick();assert.ok(h.events.includes("attach"));h.ui.stop();await tick();assert.ok(h.events.includes("track-stop"));
});
for(const mutation of [{open:false},{locked:true},{focused:false},{account:null}])test(`no camera acquisition for ${JSON.stringify(mutation)}`,async()=>{
  let begins=0;const h=fixture({begin:async()=>{begins++;}});Object.assign(h.context,mutation);await h.ui.start();assert.equal(begins,0);
});
test("a late permit after cancel is ended without requesting a stream",async()=>{
  const pending=deferred();let opens=0;const h=fixture({begin:()=>pending.promise,openStream:async()=>{opens++;}});
  const job=h.ui.start();h.ui.stop();pending.resolve({ok:true,value:{id:"late"}});await job;await tick();assert.equal(opens,0);assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==="end"&&e[1]==="late"));
});
test("a stream acquired after close is immediately stopped without attach or decode",async()=>{
  const pending=deferred();const h=fixture({openStream:()=>pending.promise});const job=h.ui.start();await tick();h.ui.stop();pending.resolve(h.stream);await job;assert.ok(h.events.includes("track-stop"));assert.ok(!h.events.includes("attach"));
});
for(const mutation of [{account:"other"},{keyRevision:3},{draftRevision:4},{open:false},{locked:true},{focused:false}])test(`late decoded recipient is fenced by ${JSON.stringify(mutation)}`,async()=>{
  const pending=deferred();const h=fixture({decode:()=>pending.promise});await h.ui.start();await tick();Object.assign(h.context,mutation);pending.resolve({ok:true,value:{ynxAccount:"ynx1original",chainId:"ynx_6423-1",asset:"YNXT"}});await tick();assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==="apply"));assert.ok(h.events.includes("track-stop"));
});
test("a valid public recipient stops every track before original parser invocation",async()=>{
  const h=fixture({decode:async()=>({ok:true,value:{ynxAccount:"ynx1original",chainId:"ynx_6423-1",asset:"YNXT",amount:"DO_NOT_USE"}})});
  await h.ui.start();await tick();const apply=h.events.findIndex(e=>Array.isArray(e)&&e[0]==="apply");assert.ok(apply>h.events.indexOf("track-stop"));assert.deepEqual(h.events[apply],["apply","ynx1original"]);
});
test("no-QR, wrong-network, nonliteral success and decode errors allow serialized retry only",async()=>{
  for(const result of [{ok:false},{ok:"true",value:{}},{ok:true,value:{ynxAccount:"ynx1original",chainId:"other",asset:"YNXT"}},null]){
    let calls=0;const h=fixture({decode:async()=>{calls++;if(result===null)throw Error("No QR");return result;}});
    await h.ui.start();await tick();assert.equal(calls,1);assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==="apply"));
    const frame=h.timers.find(t=>t.delay===500);assert.ok(frame);frame.fn();await tick();assert.equal(calls,2);h.ui.stop();
  }
});
test("permission denial reports fallback without retrying or opening a stream",async()=>{
  let opens=0;const h=fixture({begin:async()=>({ok:false}),openStream:async()=>{opens++;}});await h.ui.start();assert.equal(opens,0);assert.ok(h.events.some(e=>Array.isArray(e)&&/Camera unavailable/.test(e[1])));
});
test("acquisition deadline retires a pending OS permission intent and stops its eventual stream",async()=>{
  const pending=deferred();const h=fixture({openStream:()=>pending.promise});const job=h.ui.start();await tick();h.setTime(60000);h.timers.find(t=>t.delay===60000).fn();pending.resolve(h.stream);await job;assert.ok(h.events.includes("track-stop"));assert.ok(!h.events.includes("attach"));
});
test("old stream completion cannot stop a newer stream",async()=>{
  const pending=deferred();let opens=0,oldStopped=0;const h=fixture({openStream:()=>++opens===1?pending.promise:Promise.resolve({getTracks:()=>[{stop:()=>{}}]})});
  const old=h.ui.start();await tick();await h.ui.start();const detaches=h.events.filter(e=>e==="detach").length;
  pending.resolve({getTracks:()=>[{stop:()=>{oldStopped++;}}]});await old;assert.equal(oldStopped,1);assert.equal(h.events.filter(e=>e==="detach").length,detaches);h.ui.stop();
});
test("hardware ending stops the owned stream, but its late event cannot stop a replacement",async()=>{
  const ended=[];let stops=0;const stream={getTracks:()=>[{stop:()=>{stops++;},addEventListener:(_event,fn)=>ended.push(fn)}]};
  const h=fixture({openStream:async()=>stream});await h.ui.start();await tick();ended[0]();assert.equal(stops,1);
  await h.ui.start();await tick();ended[0]();assert.equal(stops,1);ended[1]();assert.equal(stops,2);
});
test("local camera frame encoding is bounded, audio-free public PNG only",async()=>{
  const draws=[];const canvas={getContext:()=>({drawImage:(...args)=>draws.push(args)}),toBlob:done=>done({type:"image/png",size:2,arrayBuffer:async()=>new ArrayBuffer(2)})};
  const frame=await captureRecipientFrame({videoWidth:1920,videoHeight:1080,readyState:2},canvas);
  assert.equal(canvas.width,720);assert.equal(canvas.height,405);assert.equal(draws.length,1);assert.equal(frame.mimeType,"image/png");assert.equal(frame.bytes.byteLength,2);
  assert.equal(await captureRecipientFrame({videoWidth:0,videoHeight:0,readyState:0},canvas),null);
});
function permissionFixture(){let time=0,n=0;const context={focused:true,locked:false,authenticating:false,changing:false,account:"original",revision:2};const url="file:///owned/index.html",contents={isDestroyed:()=>false,mainFrame:{url}};
  const gate=createRecipientCameraPermission({getContext:()=>({...context}),getContents:()=>contents,expectedURL:url,id:()=>String(++n),now:()=>time});
  const details={isMainFrame:true,requestingUrl:url,mediaType:"video",mediaTypes:["video"]};return {gate,context,contents,details,setTime:value=>{time=value;}};
}
test("Main video permit requires exact trusted frame/context and rejects audio, display or unknown media",()=>{
  const h=permissionFixture();assert.equal(h.gate.allows(h.contents,"media",h.details),false);const permit=h.gate.begin();
  assert.equal(h.gate.allows(h.contents,"media",h.details),true);assert.equal(h.gate.allows(h.contents,"media",h.details,true),true);
  for(const details of [{...h.details,isMainFrame:false},{...h.details,requestingUrl:"https://external.invalid"},{...h.details,mediaTypes:["audio","video"]},{...h.details,mediaTypes:[]},{...h.details,mediaTypes:undefined}])assert.equal(h.gate.allows(h.contents,"media",details),false);
  assert.equal(h.gate.allows({},"media",h.details),false);assert.equal(h.gate.allows(h.contents,"display-capture",h.details),false);
  assert.equal(h.gate.allows(h.contents,"media",{...h.details,mediaType:"unknown"},true),false);
  h.gate.end(permit.id);assert.equal(h.gate.allows(h.contents,"media",h.details),false);
});
test("Main permit cannot survive identity, focus, revision, lock, expiry or explicit invalidation",()=>{
  for(const mutation of [{account:"other"},{revision:3},{locked:true},{focused:false},{authenticating:true},{changing:true}]){const h=permissionFixture();h.gate.begin();Object.assign(h.context,mutation);assert.equal(h.gate.allows(h.contents,"media",h.details),false);}
  const h=permissionFixture();const old=h.gate.begin(),fresh=h.gate.begin();h.gate.end(old.id);assert.equal(h.gate.allows(h.contents,"media",h.details),true);h.setTime(60000);assert.equal(h.gate.allows(h.contents,"media",h.details),false);h.setTime(0);h.gate.end(fresh.id);assert.equal(h.gate.allows(h.contents,"media",h.details),false);
});
test("camera messages cover all 12 original locales without English fallback",()=>{
  for(const locale of WALLET_LOCALES)for(const key of Object.keys(CAMERA_COPY.en)){assert.ok(CAMERA_COPY[locale][key]);assert.equal(walletCopy(locale,key),CAMERA_COPY[locale][key]);if(locale!=="en")assert.notEqual(CAMERA_COPY[locale][key],key);}
});
test("actual entry wires only user-click camera, original local decoder/parser and stop fences",()=>{
  const renderer=readFileSync(new URL("../src/renderer.js",import.meta.url),"utf8"),main=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8"),html=readFileSync(new URL("../src/index.html",import.meta.url),"utf8");
  assert.match(renderer,/audio:false/);assert.match(renderer,/decode:input=>window\.ynxWallet\.paymentQR\(input\),apply:address=>paymentRecipientUI\.text\(address\)/);
  assert.match(renderer,/#start-recipient-camera.*addEventListener\("click"/);assert.match(renderer,/onInvalidate:\(\)=>recipientCameraUI\.stop\(\)/);assert.match(renderer,/visibilitychange/);assert.match(main,/recipientCameraPermission\.invalidate\(\)/);assert.match(main,/setPermissionCheckHandler/);assert.match(main,/setPermissionRequestHandler/);
  assert.match(html,/<video id="recipient-camera-video" muted playsinline/);assert.ok(!html.includes("Camera is not available in this desktop build"));
  const metadata=JSON.parse(readFileSync(new URL("../package.json",import.meta.url)));assert.match(metadata.build.mac.extendInfo.NSCameraUsageDescription,/never authorizes/);
});
