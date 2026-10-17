import test from "node:test";
import assert from "node:assert/strict";
const {createTransactionHistoryUI}=await import(process.env.YNX_HISTORY_UI_SOURCE??new URL("../src/transaction-history-ui.mjs",import.meta.url).href);
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64),olderHash="0x"+"3".repeat(64);
const record=(h=hash)=>({account,hash:h,to:"0x"+"4".repeat(40),amount:"2.0",actualFee:"1.0",blockNumber:"0x2",origin:"https://rpc-testnet.ynxweb4.com",successful:true,confirmed:true,confirmationScope:"local-snapshot",consensusFinality:false});
test("history loads account-bound older pages without discarding completed records",async()=>{
  const views=[],requests=[];
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>views.push(view),request:async cursor=>{requests.push(cursor);return {ok:true,value:{records:[record(cursor??hash)],nextCursor:cursor?null:olderHash}}}});
  await ui.refresh();await ui.older();assert.deepEqual(requests,[null,olderHash]);assert.equal(views.at(-1).records.length,2);assert.equal(views.at(-1).nextCursor,null);
});

test("same-account refresh failure retains verified rows and their original older-page cursor",async()=>{
  let last,fail=false;const requests=[];
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>{
    requests.push(cursor);if(fail&&cursor===null)throw Error("read unavailable");
    return {ok:true,value:{records:[record(cursor??hash)],nextCursor:cursor?null:olderHash}};
  }});
  await ui.refresh();const saved=last.records;fail=true;await ui.refresh();
  assert.equal(last.records,saved);assert.equal(last.nextCursor,olderHash);assert.equal(last.busy,false);assert.equal(last.loaded,false);assert.ok(last.error);
  await ui.older();assert.deepEqual(requests,[null,null,olderHash]);assert.deepEqual(last.records.map(row=>row.hash),[hash,olderHash]);
});

test("a pending same-account refresh shows retained rows but does not claim a fresh successful read",async()=>{
  let last,complete,reads=0;
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:()=>++reads===1?Promise.resolve({ok:true,value:{records:[record()],nextCursor:olderHash}}):new Promise(resolve=>complete=resolve)});
  await ui.refresh();const saved=last.records,pending=ui.refresh();
  assert.equal(last.records,saved);assert.equal(last.busy,true);assert.equal(last.loaded,false);
  complete({ok:true,value:{records:[{...record(),raw:"must not display"}],nextCursor:null}});await pending;
  assert.equal(last.records,saved);assert.equal(last.loaded,false);assert.ok(last.error);
});

test("account change clears retained rows before refresh and cannot request an old account cursor",async()=>{
  let last,selected=account;const requests=[];
  const ui=createTransactionHistoryUI({getAccount:()=>selected,render:view=>last=view,request:async cursor=>{requests.push(cursor);if(selected!==account)throw Error("unavailable");return{ok:true,value:{records:[record()],nextCursor:olderHash}}}});
  await ui.refresh();selected="0x"+"5".repeat(40);await ui.older();
  assert.deepEqual(requests,[null]);assert.equal(last.records.length,0);assert.equal(last.nextCursor,null);
  await ui.refresh();assert.equal(last.records.length,0);assert.ok(last.error);
});

test("all original public display fields are required before a completed transfer can be shown",async()=>{
  for(const key of Object.keys(record())){
    const value=record();delete value[key];let last;
    const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value:{records:[value],nextCursor:null}})});
    await ui.refresh();assert.equal(last.loaded,false,key);assert.equal(last.records.length,0,key);assert.ok(last.error,key);
  }
});
test("malformed amounts, recipients, fees, block heights and result flags cannot become displayed facts",async()=>{
  for(const patch of [{amount:"NaN"},{amount:"0.0"},{amount:2},{amount:"2e18"},{amount:"02.0"},{amount:"2.00"},{amount:"2."},{amount:"2.0000000000000000001"},{actualFee:null},{actualFee:"-1.0"},{actualFee:"1e2"},{blockNumber:"0x00"},{blockNumber:"0x0"},{blockNumber:"0x10000000000000000"},{blockNumber:2},{to:account},{to:"not a recipient"},{successful:undefined},{successful:"false"},{origin:"https://attacker.invalid"},{origin:"https://rpc-testnet.ynxweb4.com/"},{hash:{toString:()=>hash}},{privateKey:"must not be forwarded"}]){
    let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value:{records:[{...record(),...patch}],nextCursor:null}})});
    await ui.refresh();assert.equal(last.records.length,0,JSON.stringify(Object.keys(patch)));assert.ok(last.error,JSON.stringify(Object.keys(patch)));
  }
});
test("accessor-backed display values are rejected without invoking the getter",async()=>{
  let reads=0,last;const value=record();Object.defineProperty(value,"amount",{get(){reads++;return"2.0"},enumerable:true});
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value:{records:[value],nextCursor:null}})});
  await ui.refresh();assert.ok(last.error);assert.equal(last.records.length,0);assert.equal(reads,0);
});
test("older history must begin at the original inclusive cursor, not an unrelated transaction",async()=>{
  let last;const wrong="0x"+"5".repeat(64),requests=[];
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>{requests.push(cursor);return{ok:true,value:{records:[record(cursor?wrong:hash)],nextCursor:cursor?null:olderHash}}}});
  await ui.refresh();await ui.older();assert.deepEqual(requests,[null,olderHash]);assert.deepEqual(last.records.map(v=>v.hash),[hash]);assert.equal(last.nextCursor,olderHash);assert.ok(last.error);
});
test("a next cursor cannot point into already displayed records or promise a page after an empty page",async()=>{
  for(const value of [{records:[record()],nextCursor:hash},{records:[],nextCursor:olderHash}]){
    let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value})});await ui.refresh();assert.equal(last.loaded,false);assert.equal(last.records.length,0);assert.ok(last.error);
  }
  let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>({ok:true,value:{records:cursor?[]:[record()],nextCursor:cursor?null:olderHash}})});
  await ui.refresh();await ui.older();assert.equal(last.loaded,false);assert.deepEqual(last.records.map(v=>v.hash),[hash]);assert.equal(last.nextCursor,olderHash);assert.ok(last.error);
});
test("published pages are detached immutable snapshots so response or render consumers cannot taint later rows",async()=>{
  let last;const original=record(),page=[original];const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>({ok:true,value:{records:cursor?[record(cursor)]:page,nextCursor:cursor?null:olderHash}})});
  await ui.refresh();original.successful=false;original.amount="99.0";page.push(record("0x"+"6".repeat(64)));
  assert.equal(last.records.length,1);assert.equal(last.records[0].amount,"2.0");assert.equal(last.records[0].successful,true);assert.ok(Object.isFrozen(last.records));assert.ok(Object.isFrozen(last.records[0]));
  await ui.older();assert.deepEqual(last.records.map(v=>v.amount),["2.0","2.0"]);assert.deepEqual(last.records.map(v=>v.hash),[hash,olderHash]);assert.equal(last.error,null);
});
test("older-page failure leaves original verified rows intact and an explicit retry may recover that same cursor",async()=>{
  let last,bad=true;const requests=[];const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>{requests.push(cursor);return{ok:true,value:{records:cursor?[{...record(cursor),amount:bad?undefined:"3.0"}]:[record()],nextCursor:cursor?null:olderHash}}}});
  await ui.refresh();await ui.older();assert.equal(last.loaded,false);assert.equal(last.records.length,1);assert.equal(last.nextCursor,olderHash);bad=false;await ui.older();assert.equal(last.error,null);assert.deepEqual(requests,[null,olderHash,olderHash]);assert.deepEqual(last.records.map(v=>v.amount),["2.0","3.0"]);
});
test("invalid response pages, sparse records and non-boolean success envelopes fail closed",async()=>{
  for(const response of [{ok:1,value:{records:[record()],nextCursor:null}},{ok:true,value:{records:[record()],nextCursor:null,raw:"private"}},{ok:true,value:{records:new Array(1),nextCursor:null}},{ok:true,value:{records:[record()],nextCursor:{toString:()=>olderHash}}},{ok:true,value:{records:Array.from({length:51},()=>record()),nextCursor:null}},{ok:true,value:{records:[null],nextCursor:null}}]){
    let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>response});await ui.refresh();assert.equal(last.records.length,0);assert.equal(last.loaded,false);assert.ok(last.error);
  }
});
test("refresh retires an in-flight older page without losing the fresh original account page",async()=>{
  let last,complete,reads=0;const freshHash="0x"+"7".repeat(64);
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async cursor=>{reads++;if(cursor)return new Promise(resolve=>complete=resolve);return{ok:true,value:{records:[record(reads===1?hash:freshHash)],nextCursor:reads===1?olderHash:null}}}});
  await ui.refresh();const older=ui.older();await ui.refresh();complete({ok:true,value:{records:[record(olderHash)],nextCursor:null}});await older;assert.deepEqual(last.records.map(v=>v.hash),[freshHash]);assert.equal(last.loaded,true);assert.equal(last.error,null);assert.equal(last.nextCursor,null);
});
test("account change or refresh cancels late history without leaking previous account rows",async()=>{
  let selected=account,complete;const views=[];
  const ui=createTransactionHistoryUI({getAccount:()=>selected,render:view=>views.push(view),request:()=>new Promise(resolve=>complete=resolve)});
  const pending=ui.refresh();selected="0x"+"4".repeat(40);ui.clear();complete({ok:true,value:{records:[record()],nextCursor:null}});await pending;
  assert.equal(views.at(-1).records.length,0);assert.equal(views.at(-1).loaded,false);
});
test("unconfirmed, other-account, replayable raw bytes and repeated pages fail closed",async()=>{
  for(const patch of [{confirmed:false},{account:"0x"+"4".repeat(40)},{raw:"replayable"},{consensusFinality:true}]){
    let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value:{records:[{...record(),...patch}],nextCursor:null}})});
    await ui.refresh();assert.equal(last.records.length,0);assert.ok(last.error);
  }
  let last;const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>last=view,request:async()=>({ok:true,value:{records:[record()],nextCursor:olderHash}})});
  await ui.refresh();await ui.older();assert.equal(last.records.length,1);assert.ok(last.error);
});
