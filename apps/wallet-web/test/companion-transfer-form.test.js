import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {validateCompanionTransferForm} from '../src/companion-transfer-form.js';
import {NATIVE_UNIT,NATIVE_FEE_MODEL,readFeeModel,validateNativeTransferInput} from '../src/extension-fee-model.js';
import {prepareTransaction,reviewMatchesSession} from '../src/transaction-input.js';
import {catalog,LOCALES} from '../src/i18n.js';

test('Companion rejects unsupported decimal/invalid amounts without changing the input',()=>{
 for(const amount of ['50.54654','50.0','0','-1','1e3','9223372036854775807','9223372036854775808','', 'Infinity']){const form={amount,useHex:false};assert.throws(()=>validateCompanionTransferForm(form),error=>['INVALID_AMOUNT','AMOUNT_TOO_LARGE'].includes(error.code)&&error.field==='amount');assert.equal(form.amount,amount);}
 for(const amount of ['50','9007199254740993','9223372036854775806'])assert.doesNotThrow(()=>validateCompanionTransferForm({amount,useHex:false}));
});
test('advanced hex amount follows the same exact whole-YNXT/int64 bound',()=>{
 assert.doesNotThrow(()=>validateCompanionTransferForm({value:'0x'+(50n*NATIVE_UNIT).toString(16),useHex:true}));
 for(const wei of [0n,1n,50n*NATIVE_UNIT+1n,9223372036854775807n*NATIVE_UNIT])assert.throws(()=>validateCompanionTransferForm({value:'0x'+wei.toString(16),useHex:true}),error=>error.field==='value');
});
test('all locales explain whole-YNXT limitation before entry and no unchanged input is represented as rounded',()=>{
 for(const locale of LOCALES){const copy=catalog(locale.code);assert.ok(copy.amountHint.length>20);assert.ok(copy.invalidAmount.length>20);assert.match(copy.amountTooLarge,/9223372036854775806/);assert.doesNotMatch(copy.amountHint,/18/);}
 assert.match(catalog('zh-CN').amountHint,/正整数/);assert.match(catalog('zh-CN').invalidAmount,/原输入未被修改/);
});
test('actual Companion review entry validates before any provider RPC and only reviews valid integer50',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const start=source.indexOf('async function openReview() {'),end=source.indexOf('\nasync function confirmReview()',start);
 assert.ok(start>0&&end>start);const actual=source.slice(start,end);
 for(const amount of ['50.54654','0','-1','1e3','9223372036854775808','50']){
  let rpc=0,errors=[],reviews=0,focus=0;
  const form={amount,recipient:'0x'+'2'.repeat(40),useHex:false};
  const provider={request:async({method})=>{rpc++;if(method==='eth_chainId')return '0x1917';if(method==='ynx_getFeeModel')return {...NATIVE_FEE_MODEL,enabled:true};assert.fail('No signing or broadcast may occur: '+method)}};
  const state={busy:false,preparing:false,provider,account:'0x'+'1'.repeat(40),chainId:'0x1917',wallet:'ynx',epoch:1,form};
  const context=vm.createContext({state,walletActionGates:()=>({canSendTransaction:true}),validateCompanionTransferForm,prepareTransaction,readFeeModel,validateNativeTransferInput,reviewMatchesSession,formError:error=>{errors.push({code:error.code,field:error.field});focus++},text:x=>x,toYNXAddress:x=>x,replaceMarkup:()=>{},escape:x=>x,document:{querySelector:()=>({showModal:()=>{reviews++},focus:()=>{}})}});
  await vm.runInContext(actual+';openReview()',context);
  assert.equal(form.amount,amount);assert.equal(state.preparing,false);
  if(amount==='50'){assert.equal(rpc,2);assert.equal(reviews,1);assert.equal(errors.length,0)}else{assert.equal(rpc,0,amount);assert.equal(reviews,0);assert.equal(errors[0].field,'amount');assert.equal(focus,1)}
 }
});

test('actual Companion error handler focuses amount and explains the unchanged decimal input in Chinese',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const start=source.indexOf('function formError(error) {'),end=source.indexOf('\nfunction closeReview()',start);const amount={value:'50.54654',invalid:false,focused:false,setAttribute(name,value){this.invalid=name==='aria-invalid'&&value==='true'},focus(){this.focused=true}},notice={textContent:'',classList:{remove(){}}};const context=vm.createContext({text:key=>catalog('zh-CN')[key],document:{querySelector:id=>id==='#form-error'?notice:null,getElementById:field=>field==='amount'?amount:null}});vm.runInContext(source.slice(start,end)+";formError({code:'INVALID_AMOUNT',field:'amount'})",context);assert.equal(amount.value,'50.54654');assert.equal(amount.focused,true);assert.equal(amount.invalid,true);assert.match(notice.textContent,/正整数/);assert.match(notice.textContent,/原输入未被修改/);assert.doesNotMatch(notice.textContent,/whole|18/);
});
