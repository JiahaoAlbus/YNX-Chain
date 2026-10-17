import test from "node:test";
import assert from "node:assert/strict";
import {createTransactionHistoryUI} from "../src/transaction-history-ui.mjs";
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64);
const record=()=>({account,hash,to:"0x"+"3".repeat(40),amount:"2.0",actualFee:"1.0",blockNumber:"0x2",origin:"https://rpc-testnet.ynxweb4.com",successful:true,confirmed:true,confirmationScope:"local-snapshot",consensusFinality:false});
async function read(response){let view;const ui=createTransactionHistoryUI({getAccount:()=>account,request:async()=>response,render:next=>view=next});await ui.refresh();return view;}
for(const field of ["ok","value"])test(`history envelope rejects ${field} accessor without invoking it`,async()=>{
 let calls=0;const response={ok:true,value:{records:[record()],nextCursor:null}},value=response[field];
 Object.defineProperty(response,field,{enumerable:true,get(){calls++;return value;}});
 const view=await read(response);assert.equal(calls,0);assert.equal(view.records.length,0);assert.ok(view.error);
});
test("history records reject accessor indices without invoking them",async()=>{
 let calls=0;const records=[record()];Object.defineProperty(records,"0",{enumerable:true,get(){calls++;return record();}});
 const view=await read({ok:true,value:{records,nextCursor:null}});assert.equal(calls,0);assert.equal(view.records.length,0);assert.ok(view.error);
});
test("history records reject custom iterator without invoking it or substituting facts",async()=>{
 let calls=0;const records=[record()];records[Symbol.iterator]=function*(){calls++;yield {...record(),amount:"99.0"};};
 const view=await read({ok:true,value:{records,nextCursor:null}});assert.equal(calls,0);assert.equal(view.records.length,0);assert.ok(view.error);
});
test("history sparse records cannot obtain inherited rows",async()=>{
 let calls=0;const records=new Array(1),prototype=Object.create(Array.prototype);
 Object.defineProperty(prototype,"0",{get(){calls++;return record();}});Object.setPrototypeOf(records,prototype);
 const view=await read({ok:true,value:{records,nextCursor:null}});assert.equal(calls,0);assert.equal(view.records.length,0);assert.ok(view.error);
});
for(const key of ["extra",Symbol("private")])test(`history records reject non-DTO container metadata ${String(key)}`,async()=>{
 const records=[record()];records[key]="not a public row";
 const view=await read({ok:true,value:{records,nextCursor:null}});assert.equal(view.records.length,0);assert.ok(view.error);
});
test("ordinary dense public history remains a detached immutable display snapshot",async()=>{
 const original=record(),records=[original],view=await read({ok:true,value:{records,nextCursor:null}});
 original.amount="99.0";records.length=0;assert.equal(view.records[0].amount,"2.0");assert.ok(view.loaded);assert.ok(Object.isFrozen(view.records));assert.ok(Object.isFrozen(view.records[0]));
});
test("bad older container preserves verified rows and permits explicit same-cursor retry",async()=>{
 let view,calls=0,bad=true;const next="0x"+"4".repeat(64),requests=[];
 const ui=createTransactionHistoryUI({getAccount:()=>account,render:value=>view=value,request:async cursor=>{
  requests.push(cursor);const rows=[{...record(),hash:cursor??hash}];
  if(cursor&&bad)Object.defineProperty(rows,"0",{get(){calls++;return {...record(),hash:next};},enumerable:true});
  return {ok:true,value:{records:rows,nextCursor:cursor?null:next}};
 }});
 await ui.refresh();await ui.older();assert.equal(calls,0);assert.deepEqual(view.records.map(row=>row.hash),[hash]);assert.equal(view.nextCursor,next);assert.ok(view.error);
 bad=false;await ui.older();assert.deepEqual(requests,[null,next,next]);assert.deepEqual(view.records.map(row=>row.hash),[hash,next]);assert.equal(view.error,null);
});
