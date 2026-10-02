import test from "node:test";
import assert from "node:assert/strict";
import {createTransactionHistoryUI} from "../src/transaction-history-ui.mjs";
const account="0x"+"1".repeat(40),hash="0x"+"2".repeat(64),olderHash="0x"+"3".repeat(64);
const record=(h=hash)=>({account,hash:h,confirmed:true,confirmationScope:"local-snapshot",consensusFinality:false});
test("history loads account-bound older pages without discarding completed records",async()=>{
  const views=[],requests=[];
  const ui=createTransactionHistoryUI({getAccount:()=>account,render:view=>views.push(view),request:async cursor=>{requests.push(cursor);return {ok:true,value:{records:[record(cursor??hash)],nextCursor:cursor?null:olderHash}}}});
  await ui.refresh();await ui.older();assert.deepEqual(requests,[null,olderHash]);assert.equal(views.at(-1).records.length,2);assert.equal(views.at(-1).nextCursor,null);
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
