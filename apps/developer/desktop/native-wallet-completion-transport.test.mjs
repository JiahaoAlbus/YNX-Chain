import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('./macos/main.m',import.meta.url),'utf8');
test('native Wallet completion bridge transports exact CAS inputs and propagates native errors',async()=>{
 const raw=source.match(/NSString \*walletScript=@"((?:[^"\\]|\\.)*)";/)[1];
 const script=JSON.parse('"'+raw+'"'),messages=[],listeners={};
 const window={webkit:{messageHandlers:{ynxLocalWallet:{postMessage:body=>messages.push(body)}}}};
 runInNewContext(script,{window,location:{pathname:'/'},crypto:{randomUUID},setTimeout:()=>1,clearTimeout(){},addEventListener:(name,fn)=>listeners[name]=fn});
 const storage=window.ynxDesktopWallet.protectedStorage;
 const operations=[
 ['saveRevocationIntent',['key','intent'],'storage-save-intent',{key:'key',rawIntent:'intent'},'intent'],
 ['finishRevocationIntentWithCompletion',['key','intent','receipt'],'storage-finish-intent',{key:'key',expectedRawIntent:'intent',receiptRaw:'receipt'},'receipt'],
 ['getRevocationCompletions',['history'],'storage-get-completions',{key:'history'},'[]'],
 ['getRevocationCompletion',['history','id'],'storage-get-completion',{key:'history',intentId:'id'},null],
 ['acknowledgeRevocationCompletion',['history','receipt'],'storage-ack-completion',{key:'history',expectedReceiptRaw:'receipt'},null],
 ['consumerJournalPersist',['receipt'],'consumer-journal-persist',{receiptRaw:'receipt'},'receipt'],
 ['consumerJournalRead',['id'],'consumer-journal-read',{intentId:'id'},null]];
 for(const [name,args,action,body,result]of operations){
  const promise=storage[name](...args),message=messages.pop();assert.equal(message.action,action);
  const {id,...rest}=message;assert.deepEqual(JSON.parse(JSON.stringify(rest)),{action,...body});
  window.__ynxNativeWalletReply({id,ok:true,value:result});assert.equal(await promise,result);
 }
 const failed=storage.finishRevocationIntentWithCompletion('key','intent','receipt'),message=messages.pop();
 window.__ynxNativeWalletReply({id:message.id,ok:false,error:'Protected state outcome is UNKNOWN'});
 await assert.rejects(failed,/UNKNOWN/);
 const pending=storage.getRevocationCompletions('history');listeners.pagehide();await assert.rejects(pending,/document closed/);
});
