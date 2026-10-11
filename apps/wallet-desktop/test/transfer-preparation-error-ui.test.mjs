import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {WALLET_COPY,WALLET_LOCALES,initWalletLocale} from '../src/wallet-locale.mjs';
import {TRANSFER_ERROR_KEYS,TRANSFER_ERROR_COPY} from '../src/wallet-locale-transfer-errors.mjs';
import {renderTransferPreparationError} from '../src/transfer-preparation-error-ui.mjs';
const renderer=fs.readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
function mounted(){const document={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[]};const locale=initWalletLocale({document,systemLanguages:['zh-CN'],getStorage:()=>null});return{document,locale,node:{ownerDocument:document,textContent:'',isConnected:true}};}
test('all twelve normal catalogs register all known balance refusals',()=>{for(const locale of WALLET_LOCALES)for(const key of TRANSFER_ERROR_KEYS){assert.equal(WALLET_COPY[locale][key],TRANSFER_ERROR_COPY[locale][key]);if(locale!=='en')assert.notEqual(WALLET_COPY[locale][key],key);}});
test('actual normal transfer prepare handler uses owned localized error rendering',async()=>{
 const ui=mounted(),nodes=new Map([['#transfer-to',{value:'ynx1-public'}],['#transfer-amount',{value:'1'}],['#send-sheet',{open:true}],['#prepare-transfer',{}],['#transfer-result',ui.node],['#transfer-review',{hidden:false}]]);
 ui.document.querySelector=selector=>nodes.get(selector);const operation={};let prepared=0;
 const start=renderer.indexOf('async event => {',renderer.indexOf('document.querySelector("#transfer-form")'));
 const end=renderer.indexOf('\nasync function actOnTransfer',start);
 const expression=renderer.slice(start,end).trim().replace(/\);$/,'');
 const context={document:ui.document,keyState:{locked:false,authenticating:false,revision:1},activeAccount:'qa',paymentDraftRevision:0,transferReview:null,invalidatePaymentInput(){},beginAccountOperation(){return operation;},accountOperationCurrent:()=>true,finishAccountOperation(){},copyUI(node,key){node.textContent=key;},renderTransferPreparationError,errorText:result=>result.error.message,window:{ynxWallet:{async prepareTransfer(){prepared++;return{ok:false,error:{code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0]}};}}}};
 await vm.runInNewContext(`(${expression})`,context)({preventDefault(){}});
 assert.equal(prepared,1);assert.equal(ui.node.textContent,TRANSFER_ERROR_COPY['zh-Hans'][TRANSFER_ERROR_KEYS[0]]);assert.equal(nodes.get('#transfer-review').hidden,true);
});
test('display switches locale but does not mutate the error or suppress unknown outcomes',()=>{
 const ui=mounted();const error=Object.freeze({code:'INSUFFICIENT_FUNDS',message:TRANSFER_ERROR_KEYS[0]});assert.equal(renderTransferPreparationError(ui.node,error),true);ui.locale.select('zh-Hant');assert.equal(ui.node.textContent,TRANSFER_ERROR_COPY['zh-Hant'][error.message]);assert.equal(error.message,TRANSFER_ERROR_KEYS[0]);
 for(const foreign of [{...error,outcomeUnknown:true,transactionHash:'0xExact'},{...error,code:'REMOTE_REFUSAL'},{...error,message:'remote text <script>'},{code:'FAMILY_RPC_TIMEOUT',message:'FAMILY_RPC_TIMEOUT'},null]){ui.node.textContent='original diagnostic';assert.equal(renderTransferPreparationError(ui.node,foreign),false);assert.equal(ui.node.textContent,'original diagnostic');}
});
