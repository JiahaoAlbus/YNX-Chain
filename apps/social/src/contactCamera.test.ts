import assert from "node:assert/strict";
import test from "node:test";
import {CameraQRSession} from "../web/contact-camera.mjs";

const personalQR='https://social.ynxweb4.com/people/sp_'+'A'.repeat(32);
function fixture(){
  let current=true,stops=0,opens=0,attached=0;
  const frames:Array<()=>Promise<void>>=[],statuses:string[]=[],results:string[]=[];
  const stream={getTracks:()=>[{stop:()=>{stops++}}]};
  const options={mediaDevices:{getUserMedia:async()=>{opens++;return stream}},video:{},isCurrent:()=>current,detector:async()=>({detect:async()=>[{rawValue:personalQR}]}),attach:async()=>{attached++},detach:()=>{},schedule:(callback:()=>Promise<void>)=>{frames.push(callback);return frames.length},cancel:()=>{},status:(text:string)=>statuses.push(text),result:(value:string)=>results.push(value)};
  return {options,frames,statuses,results,stream,scanner:new CameraQRSession(options),invalidate:()=>{current=false},stats:()=>({stops,opens,attached})};
}
test("camera decoding releases stream and only returns QR content",async()=>{
  const f=fixture();await f.scanner.start();assert.deepEqual(f.stats(),{stops:0,opens:1,attached:1});await f.frames[0]!();assert.deepEqual(f.results,[personalQR]);assert.equal(f.stats().stops,1);
});
test('unrelated QR is rejected without dispatch and valid invitation can be scanned next',async()=>{
 const f=fixture();let raw='wc:synthetic-pair';f.options.detector=async()=>({detect:async()=>[{rawValue:raw}]});await f.scanner.start();await f.frames[0]!();assert.deepEqual(f.results,[]);assert.equal(f.stats().stops,0);assert.match(f.statuses.at(-1)!,/not contact requests/);raw='https://social.ynxweb4.com/invite/'+'B'.repeat(32);await f.frames[1]!();assert.deepEqual(f.results,[raw]);assert.equal(f.stats().stops,1);
});
test("cancel before permission resolves releases late stream without attaching",async()=>{
  const f=fixture();let grant!:(stream:any)=>void;f.options.mediaDevices.getUserMedia=()=>new Promise(resolve=>{grant=resolve});const start=f.scanner.start();await Promise.resolve();f.scanner.stop();grant(f.stream);await start;assert.equal(f.stats().stops,1);assert.equal(f.stats().attached,0);assert.equal(f.frames.length,0);
});
test("unsupported scanner never requests camera permission",async()=>{
  const f=fixture();f.options.detector=async()=>{throw new DOMException("unsupported","NotSupportedError")};await f.scanner.start();assert.equal(f.stats().opens,0);assert.match(f.statuses.at(-1)!,/unavailable/);
});
test("denied camera permission gives retry guidance and can retry",async()=>{
  const f=fixture();const open=f.options.mediaDevices.getUserMedia;f.options.mediaDevices.getUserMedia=async()=>{throw new DOMException("denied","NotAllowedError")};await f.scanner.start();assert.match(f.statuses.at(-1)!,/denied/);f.options.mediaDevices.getUserMedia=open;await f.scanner.start();await f.frames[0]!();assert.equal(f.results.length,1);
});
test("account invalidation during decode stops camera and discards result",async()=>{
  const f=fixture();let decoded!:(codes:any)=>void;f.options.detector=async()=>({detect:()=>new Promise(resolve=>{decoded=resolve})});await f.scanner.start();const pending=f.frames[0]!();f.invalidate();decoded([{rawValue:"old-account-qr"}]);await pending;assert.equal(f.stats().stops,1);assert.deepEqual(f.results,[]);
});
test("superseding a camera attempt cannot reattach the older stream",async()=>{
  const f=fixture();let oldGrant!:(stream:any)=>void;const open=f.options.mediaDevices.getUserMedia;f.options.mediaDevices.getUserMedia=()=>new Promise(resolve=>{oldGrant=resolve});const old=f.scanner.start();await Promise.resolve();f.options.mediaDevices.getUserMedia=open;await f.scanner.start();oldGrant(f.stream);await old;assert.equal(f.stats().attached,1);assert.equal(f.stats().stops,1);f.scanner.stop();assert.equal(f.stats().stops,2);
});
