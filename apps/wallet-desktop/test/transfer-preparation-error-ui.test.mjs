import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {WALLET_COPY,WALLET_LOCALES,initWalletLocale} from '../src/wallet-locale.mjs';
import {TRANSFER_ERROR_KEYS,TRANSFER_ERROR_COPY} from '../src/wallet-locale-transfer-errors.mjs';
import {renderTransferPreparationError} from '../src/transfer-preparation-error-ui.mjs';
import {rpcResponseError} from '../src/rpc-errors.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
const renderer=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
function mounted(){const document={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[]};const locale=initWalletLocale({document,systemLanguages:['zh-CN'],getStorage:()=>null});return{document,locale,node:{ownerDocument:document,textContent:'',isConnected:true}};}
test('all twelve normal catalogs register all known balance refusals',()=>{for(const locale of WALLET_LOCALES)for(const key of TRANSFER_ERROR_KEYS){assert.equal(WALLET_COPY[locale][key],TRANSFER_ERROR_COPY[locale][key]);if(locale!=='en')assert.notEqual(WALLET_COPY[locale][key],key);}});
test('actual normal transfer prepare handler uses owned localized error rendering',async()=>{
 const ui=mounted(),nodes=new Map([['#transfer-to',{value:'ynx1-public'}],['#transfer-amount',{value:'1'}],['#send-sheet',{open:true}],['#prepare-transfer',{}],['#transfer-result',ui.node],['#transfer-review',{hidden:false}]]);
 ui.document.querySelector=selector=>nodes.get(selector);const operation={};let prepared=0;
 const start=renderer.indexOf('async event => {',renderer.indexOf('document.querySelector("#transfer-form")'));
 const end=renderer.indexOf('\nasync function actOnTransfer',start);
 const expression=renderer.slice(start,end).trim().replace(/\);$/,'');
 const context={document:ui.document,keyState:{locked:false,authenticating:false,revision:1},activeAccount:'qa',paymentDraftRevision:0,transferReview:null,invalidatePaymentInput(){},beginAccountOperation(){return operation;},accountOperationCurrent:()=>true,finishAccountOperation(){},copyUI(node,key){node.textContent=key;},renderTransferPreparationError,errorText:result=>result.error.message,window:{ynxWallet:{async prepareTransfer(){prepared++;return{ok:false,error:{code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0],displayOrigin:'LOCAL_TRANSFER_PREPARATION'}};}}}};
 await vm.runInNewContext(`(${expression})`,context)({preventDefault(){}});
 assert.equal(prepared,1);assert.equal(ui.node.textContent,TRANSFER_ERROR_COPY['zh-Hans'][TRANSFER_ERROR_KEYS[0]]);assert.equal(nodes.get('#transfer-review').hidden,true);
});
test('matching code and message are insufficient without owned local provenance',()=>{
 const ui=mounted();
 for(const error of [
  {code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0]},
  {code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0],displayOrigin:'RPC'},
  {code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0],displayOrigin:'LOCAL_TRANSFER_PREPARATION',transactionHash:'0xExact'},
  {code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0],displayOrigin:'LOCAL_TRANSFER_PREPARATION',outcomeUnknown:true},
 ]){ui.node.textContent='original diagnostic';assert.equal(renderTransferPreparationError(ui.node,error),false);assert.equal(ui.node.textContent,'original diagnostic');}
});
test('actual main projection annotates only opted-in definite local preparation refusals',async()=>{
 const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
 const start=main.indexOf('async function safeIPC('),end=main.indexOf('function safeErrorClass(',start);
 const safeIPC=vm.runInNewContext(`(()=>{${main.slice(start,end)};return safeIPC;})()`);
 const local=Object.assign(new Error(TRANSFER_ERROR_KEYS[0]),{code:-32000,data:{code:'INSUFFICIENT_FUNDS'}});
 const fail=error=>async()=>{throw error;};
 const opted=await safeIPC(fail(local),{localTransferPreparation:true});
 assert.equal(opted.error.displayOrigin,'LOCAL_TRANSFER_PREPARATION');
 assert.equal(opted.error.message,local.message);
 assert.equal((await safeIPC(fail(local))).error.displayOrigin,undefined);
 for(const [index,message] of TRANSFER_ERROR_KEYS.entries()){
  const refusal=Object.assign(new Error(message),{code:index===2?4900:-32000,data:{code:'INSUFFICIENT_FUNDS'}});
  const projected=await safeIPC(fail(refusal),{localTransferPreparation:true});
  assert.equal(projected.error.displayOrigin,'LOCAL_TRANSFER_PREPARATION');
  assert.equal(projected.error.message,message);assert.equal(projected.error.code,'INSUFFICIENT_FUNDS');
 }
 const remote=rpcResponseError({code:-32000,message:local.message},{method:'eth_estimateGas',httpSuccess:true});
 // Even a remote adapter exposing the same display code must not become local.
 remote.data.code='INSUFFICIENT_FUNDS';
 for(const error of [remote,
  Object.assign(new Error(local.message),{code:-32000,data:{code:'INSUFFICIENT_FUNDS',transactionHash:'0xExact'}}),
  Object.assign(new Error(local.message),{code:-32000,data:{code:'INSUFFICIENT_FUNDS',outcomeUnknown:true,transactionHash:'0xExact'}}),
  Object.assign(new Error(local.message),{code:-32000,transactionHash:'0xExact',data:{code:'INSUFFICIENT_FUNDS'}}),
  Object.assign(new Error(local.message),{code:-32000,data:{code:'INSUFFICIENT_FUNDS',rpcResponse:false}}),
  Object.assign(new Error(local.message),{data:{code:'INSUFFICIENT_FUNDS'}}),
  Object.assign(new Error('arbitrary remote text'),{code:-32000,data:{code:'INSUFFICIENT_FUNDS'}}),
 ]){
  const projected=await safeIPC(fail(error),{localTransferPreparation:true});
  assert.equal(projected.error.displayOrigin,undefined);assert.equal(projected.error.message,error.message);
  if(error.data.outcomeUnknown){assert.equal(projected.error.outcomeUnknown,true);assert.equal(projected.error.transactionHash,'0xExact');}
 }
});
test('preparation display option traverses original sensitive key access guard only on prepare route',async()=>{
 const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
 const declaration=main.match(/^const sensitiveIPC = .*;$/m)?.[0];assert.ok(declaration);
 const seen=[];const options={lease:'fixture'};
 const sensitive=vm.runInNewContext(`(()=>{${declaration};return sensitiveIPC;})()`,{
  safeIPC:async(action,display)=>{seen.push(['display',display]);return action();},
  keyAccess:{async run(action,keyOptions){seen.push(['key',keyOptions]);return action();}},
 });
 const value=await sensitive(async()=> 'public-fixture',options,{localTransferPreparation:true});
 assert.equal(value,'public-fixture');assert.equal(seen[0][1].localTransferPreparation,true);assert.equal(seen[1][1],options);
 const call=main.match(/^handleWalletIPC\("wallet:prepare-transfer".*$/m)?.[0];assert.ok(call);
 assert.match(call,/sensitiveIPC\(/);assert.match(call,/localTransferPreparation:\s*true/);
 assert.equal((main.match(/localTransferPreparation:\s*true/g)??[]).length,1);
 const start=main.indexOf('async function safeIPC('),end=main.indexOf('function safeErrorClass(',start);
 const routeCalls=new Map(),guards=[];
 const preparedInput={to:'ynx1-public',amount:'1'};
 const context={handleWalletIPC:(name,handler)=>routeCalls.set(name,handler),nativeWallet:{async prepareTransfer(input){assert.equal(input,preparedInput);throw Object.assign(new Error(TRANSFER_ERROR_KEYS[0]),{code:-32000,data:{code:'INSUFFICIENT_FUNDS'}});}},keyAccess:{async run(action,keyOptions){guards.push(['before',keyOptions]);const result=await action();guards.push(['after',keyOptions]);return result;}}};
 vm.runInNewContext(`${main.slice(start,end)};${declaration};${call}`,context);
 const projected=await routeCalls.get('wallet:prepare-transfer')(null,preparedInput);
 assert.equal(guards.length,1);assert.equal(guards[0][0],'before');assert.equal(guards[0][1],undefined);
 assert.equal(projected.error.displayOrigin,'LOCAL_TRANSFER_PREPARATION');
 const ui=mounted();assert.equal(renderTransferPreparationError(ui.node,projected.error),true);
 assert.equal(ui.node.textContent,TRANSFER_ERROR_COPY['zh-Hans'][TRANSFER_ERROR_KEYS[0]]);
});
test('display switches locale but does not mutate the error or suppress unknown outcomes',()=>{
 const ui=mounted();const error=Object.freeze({code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0],displayOrigin:'LOCAL_TRANSFER_PREPARATION'});assert.equal(renderTransferPreparationError(ui.node,error),true);ui.locale.select('zh-Hant');assert.equal(ui.node.textContent,TRANSFER_ERROR_COPY['zh-Hant'][error.message]);assert.equal(error.message,TRANSFER_ERROR_KEYS[0]);
 for(const foreign of [{...error,outcomeUnknown:true,transactionHash:'0xExact'},{...error,code:'REMOTE_REFUSAL'},{...error,message:'remote text <script>'},{code:'FAMILY_RPC_TIMEOUT',message:'FAMILY_RPC_TIMEOUT'},null]){ui.node.textContent='original diagnostic';assert.equal(renderTransferPreparationError(ui.node,foreign),false);assert.equal(ui.node.textContent,'original diagnostic');}
});
test('actual preparation chain retains lifecycle locked-before and blur-after guards',async()=>{
 const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
 const declaration=main.match(/^const sensitiveIPC = .*;$/m)[0];
 const call=main.match(/^handleWalletIPC\("wallet:prepare-transfer".*$/m)[0];
 const start=main.indexOf('async function safeIPC('),end=main.indexOf('function safeErrorClass(',start);
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},method:'public-test-fixture'},schedule:()=>null,unschedule(){}});
 lifecycle.setAccount('public-qa');lifecycle.setFocused(true);
 let invoked=0,release,entered;
 const enteredPromise=new Promise(resolve=>{entered=resolve;});
 const suspended=new Promise(resolve=>{release=resolve;});
 let route;
 const context={keyAccess:lifecycle,handleWalletIPC:(_name,handler)=>{route=handler;},nativeWallet:{async prepareTransfer(){invoked++;entered();await suspended;return{publicPreview:true};}}};
 vm.runInNewContext(`${main.slice(start,end)};${declaration};${call}`,context);
 const locked=await route(null,{});assert.equal(locked.error.code,'WALLET_LOCKED');assert.equal(invoked,0);assert.equal(locked.error.displayOrigin,undefined);
 await lifecycle.unlock();const pending=route(null,{});await enteredPromise;
 lifecycle.setFocused(false);release();const cancelled=await pending;
 assert.equal(invoked,1);assert.equal(cancelled.error.code,'WALLET_OPERATION_CANCELLED');assert.equal(cancelled.error.displayOrigin,undefined);assert.equal(lifecycle.status().locked,true);
});
