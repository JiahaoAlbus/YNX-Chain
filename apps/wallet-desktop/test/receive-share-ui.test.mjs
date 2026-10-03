import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createReceiveShareUI} from "../src/receive-share-ui.mjs";
const account="ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt",uri=`ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const code={account,chainId:"ynx_6423-1",asset:"YNXT",uri};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(requestCode=async()=>({ok:true,value:code})){
  const context={account,open:true},writes=[],messages=[];
  const ui=createReceiveShareUI({getContext:()=>({...context}),requestCode,writeClipboard:async value=>writes.push(value),report:value=>messages.push(value)});
  return {ui,context,writes,messages};
}
test("receiving share copies exactly the native address/network/asset link and no payment authority",async()=>{
  const f=setup();await f.ui.copyLink();assert.deepEqual(f.writes,[uri]);assert.match(f.messages.at(-1),/enter an amount/);
  assert.equal(/amount=|callback=|symKey=|signature=/.test(f.writes[0]),false);
});
test("wrong account, network, asset, URI or failed IPC cannot write a receiving link",async()=>{
  for(const delta of [{account:"other"},{chainId:"ynx_1-1"},{asset:"OTHER"},{uri:uri+"&amount=10"},{uri:"https://untrusted.invalid"}]){
    const f=setup(async()=>({ok:true,value:{...code,...delta}}));await f.ui.copyLink();assert.deepEqual(f.writes,[]);assert.match(f.messages.at(-1),/unavailable/);
  }
  for(const result of [null,{ok:false},{ok:true,value:null}]){const f=setup(async()=>result);await f.ui.copyLink();assert.deepEqual(f.writes,[])}
});
test("close, account change, and same-account reopen invalidate late share requests",async()=>{
  for(const change of [f=>f.context.open=false,f=>f.context.account="other",f=>f.ui.invalidate()]){
    const pending=deferred(),f=setup(()=>pending.promise),job=f.ui.copyLink();change(f);const before=[...f.messages];
    pending.resolve({ok:true,value:code});await job;assert.deepEqual(f.writes,[]);assert.deepEqual(f.messages,before);
  }
});
test("new share attempt supersedes an older result and clipboard rejection is retryable",async()=>{
  const first=deferred();let calls=0;const f=setup(()=>++calls===1?first.promise:Promise.resolve({ok:true,value:code}));
  const old=f.ui.copyLink();await f.ui.copyLink();const messages=[...f.messages];first.resolve({ok:false});await old;
  assert.deepEqual(f.writes,[uri]);assert.deepEqual(f.messages,messages);
  let failed=true;const reports=[],writes=[];
  const ui=createReceiveShareUI({getContext:()=>({open:true,account}),requestCode:async()=>({ok:true,value:code}),writeClipboard:async value=>{if(failed)throw Error("denied");writes.push(value)},report:v=>reports.push(v)});
  await ui.copyLink();assert.match(reports.at(-1),/unavailable/);failed=false;await ui.copyLink();assert.deepEqual(writes,[uri]);
});
test("an old OS write cannot finish after and overwrite a new account receiving link",async()=>{
  const blocked=deferred(),context={open:true,account},writes=[];let value="",count=0;
  const ui=createReceiveShareUI({getContext:()=>({...context}),requestCode:async selected=>({ok:true,value:{account:selected,chainId:"ynx_6423-1",asset:"YNXT",uri:`ynx:${selected}?chainId=ynx_6423-1&asset=YNXT`}}),
    writeClipboard:async text=>{writes.push(text);if(++count===1)await blocked.promise;value=text},report:()=>{}});
  const old=ui.copyLink();await tick();
  context.account="ynx1-synthetic-second-account";ui.invalidate();const newer=ui.copyLink();await tick();
  const startedWhileOldWritePending=writes.length;blocked.resolve();await Promise.all([old,newer]);
  assert.equal(startedWhileOldWritePending,1,"new OS write must await the old write's completion");
  assert.equal(value,`ynx:${context.account}?chainId=ynx_6423-1&asset=YNXT`);
});
test("a queued copy invalidated by close never enters the OS clipboard",async()=>{
  const blocked=deferred(),context={open:true,account},writes=[];let count=0;
  const ui=createReceiveShareUI({getContext:()=>({...context}),requestCode:async()=>({ok:true,value:code}),writeClipboard:async text=>{writes.push(text);if(++count===1)await blocked.promise},report:()=>{}});
  const first=ui.copyLink();await tick();const second=ui.copyLink();await tick();
  context.open=false;ui.invalidate();blocked.resolve();await Promise.all([first,second]);
  assert.deepEqual(writes,[uri]);
});
test("public address and receiving link use the same IPC identity validation and write queue",async()=>{
  const blocked=deferred(),writes=[];let count=0;
  const ui=createReceiveShareUI({getContext:()=>({account,open:true,keyRevision:1}),requestCode:async()=>({ok:true,value:code}),writeClipboard:async text=>{writes.push(text);if(++count===1)await blocked.promise},report:()=>{}});
  const link=ui.copyLink();await tick();const publicAddress=ui.copyAddress();await tick();
  const writesBeforeOldCompletion=[...writes];blocked.resolve();await Promise.all([link,publicAddress]);
  assert.deepEqual(writesBeforeOldCompletion,[uri]);assert.deepEqual(writes,[uri,account]);
  const bad=setup(async()=>({ok:true,value:{...code,account:"other"}}));await bad.ui.copyAddress();assert.deepEqual(bad.writes,[]);
});
test("lock invalidation while identity IPC is pending cannot publish or copy an old result",async()=>{
  const pending=deferred(),context={open:true,account,keyRevision:1},writes=[],messages=[];
  const ui=createReceiveShareUI({getContext:()=>({...context}),requestCode:()=>pending.promise,writeClipboard:async text=>writes.push(text),report:text=>messages.push(text)});
  const job=ui.copyAddress();context.keyRevision++;const before=[...messages];pending.resolve({ok:true,value:code});await job;
  assert.deepEqual(writes,[]);assert.deepEqual(messages,before);
});
test("a rejected old OS write does not poison a new explicit copy",async()=>{
  let reject;const oldOS=new Promise((_resolve,fail)=>reject=fail),writes=[];let count=0;
  const ui=createReceiveShareUI({getContext:()=>({open:true,account}),requestCode:async()=>({ok:true,value:code}),writeClipboard:async text=>{if(++count===1)await oldOS;writes.push(text)},report:()=>{}});
  const first=ui.copyLink();await tick();const newer=ui.copyAddress();await tick();reject(new Error("denied"));await Promise.all([first,newer]);
  assert.deepEqual(writes,[account]);
});
test("manual address selection fallback stays available only for the still-current copy",async()=>{
  let selected=0;const reports=[];
  const ui=createReceiveShareUI({getContext:()=>({open:true,account}),requestCode:async()=>({ok:true,value:code}),writeClipboard:async()=>{throw Error("denied")},selectAddress:()=>selected++,report:value=>reports.push(value)});
  await ui.copyAddress();assert.equal(selected,1);assert.match(reports.at(-1),/Select and copy/);
  await ui.copyLink();assert.equal(selected,1);assert.match(reports.at(-1),/unavailable/);
  const invalid=createReceiveShareUI({getContext:()=>({open:true,account}),requestCode:async()=>({ok:false}),writeClipboard:async()=>{throw Error("unexpected")},selectAddress:()=>selected++,report:value=>reports.push(value)});
  await invalid.copyAddress();assert.equal(selected,1);assert.match(reports.at(-1),/Receiving data unavailable/);
});
test("actual renderer routes both Receive copy buttons through one controller and OS write adapter",async()=>{
  const source=await readFile(new URL("../src/renderer.js",import.meta.url),"utf8");
  assert.equal([...source.matchAll(/navigator\.clipboard\.writeText\(/g)].length,1);
  assert.match(source, /#copy-address"\)\.addEventListener\("click",\(\)=>void receiveShareUI\.copyAddress\(\)\)/);
  assert.match(source, /#copy-receiving-link"\)\.addEventListener\("click",\(\)=>void receiveShareUI\.copyLink\(\)\)/);
  assert.match(source, /account:accountState\?\.ynxAccount,keyRevision:keyState\.revision/);
});
