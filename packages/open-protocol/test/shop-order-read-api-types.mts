import{encodeShopOrderReadInputDATA,decodeShopOrderReadInputDATA,bindShopOrderReadInputDATA,shopOrderReadToolDescriptorDATA}from'../src/shop-order-read.js';
import type{ShopOrderReadSelection}from'../src/shop-order-read.js';
const s:ShopOrderReadSelection={orderId:'PUBLIC-order',fields:['status'],snapshot:'12'.repeat(64)};
const input:Uint8Array=encodeShopOrderReadInputDATA(s);const selected:ShopOrderReadSelection=decodeShopOrderReadInputDATA(input);bindShopOrderReadInputDATA(input);shopOrderReadToolDescriptorDATA();void selected;
// @ts-expect-error Address is not an allowed model projection field.
encodeShopOrderReadInputDATA({...s,fields:['address']});
// @ts-expect-error JSON approved flags cannot substitute original proof bytes.
encodeShopOrderReadInputDATA({...s,approved:true});
import{encodeShopOrderReadBindingDATA,decodeShopOrderReadBindingDATA,encodeShopOrderReadProofDATA,decodeShopOrderReadProofDATA}from'../src/shop-order-read.js';
import type{ShopOrderReadTaskEffectBindingDATA,ShopOrderReadExpectedProfileDATA,ShopOrderReadProofDATA}from'../src/shop-order-read.js';
declare const binding:ShopOrderReadTaskEffectBindingDATA,profile:ShopOrderReadExpectedProfileDATA,proof:ShopOrderReadProofDATA;
const w=encodeShopOrderReadBindingDATA(binding,input,profile);decodeShopOrderReadBindingDATA(w,input,profile);decodeShopOrderReadProofDATA(encodeShopOrderReadProofDATA(proof,proof.purpose),proof.purpose);
// @ts-expect-error The original selected target/kind is required independently.
encodeShopOrderReadBindingDATA(binding,input);
// @ts-expect-error Boolean approval does not implement original proof bytes.
encodeShopOrderReadProofDATA({approved:true},'PUBLIC');
// @ts-expect-error DATA has no signature/current verification flag.
const verified:boolean=decodeShopOrderReadProofDATA(w,'PUBLIC').verified;
void verified;
