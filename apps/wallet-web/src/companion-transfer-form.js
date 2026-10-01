// Companion presentation validation only. The Wallet and verified RPC retain
// their independent capability/signing checks. Never round or mutate input.
import {NATIVE_UNIT} from './extension-fee-model.js';
// NativeAmount reserves the fixed 1 YNXT fee inside signed int64.
const MAX_NATIVE_AMOUNT=9223372036854775807n-1n;
const fail=(code,field)=>{throw Object.assign(new Error(code),{code,field})};
export function validateCompanionTransferForm(form){
 const field=form.useHex?'value':'amount';
 let whole;
 if(form.useHex){
  const value=typeof form.value==='string'?form.value.trim():'';
  if(!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))fail('INVALID_HEX_VALUE',field);
  const wei=BigInt(value);
  if(wei<=0n||wei%NATIVE_UNIT!==0n)fail('INVALID_AMOUNT',field);
  whole=wei/NATIVE_UNIT;
 }else{
  const value=typeof form.amount==='string'?form.amount.trim():'';
  if(value.length>100||!/^\d+$/.test(value))fail('INVALID_AMOUNT',field);
  whole=BigInt(value);
  if(whole<=0n)fail('INVALID_AMOUNT',field);
 }
 if(whole>MAX_NATIVE_AMOUNT)fail('AMOUNT_TOO_LARGE',field);
}
