import assert from "node:assert/strict";
import test from "node:test";
import {createReceiveShareUI} from "../src/receive-share-ui.mjs";
const account="ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt",uri=`ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const code={account,chainId:"ynx_6423-1",asset:"YNXT",uri};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
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
