import test from 'node:test';
import assert from 'node:assert/strict';
import {SocialAPI} from './api';
import {AccountIntentIndex} from './accountIntentIndex';
const account='ynx1'+'a'.repeat(38),key=`ynx.social.moment.intent.v1.${account}`;
const original=JSON.stringify({schemaVersion:1,account,idempotencyKey:'native-moment-'+'a'.repeat(32),text:'Original unknown publication',visibility:'private',media:[]});
for(const [name,body] of [['false','{"deleted":false}'],['missing','{}'],['string','{"deleted":"true"}'],['invalidJSON','not-json']] as const){
 test(`existing deletion success schema must reject ${name} before cleanup`,async()=>{
  const prior=globalThis.fetch,data=new Map<string,string>();
  const storage={read:async(k:string)=>data.get(k)??null,write:async(k:string,v:string)=>{data.set(k,v)},remove:async(k:string)=>{data.delete(k)}};
  const index=new AccountIntentIndex(storage);await index.bind(account,()=>true).write(key,original);
  globalThis.fetch=async()=>new Response(body,{status:200});
  try{const api=new SocialAPI('https://social.example','original-token');
   let accepted=false;try{const receipt=await api.deleteAccountReceipt(account);await index.cleanupConfirmed(receipt.account,receipt.current);accepted=true;}catch{}
   assert.equal(accepted,false,'non-success deletion body was promoted to a cleanup receipt');
   assert.equal(data.get(key),original,'original pending content removed');
  }finally{globalThis.fetch=prior}
 });
}
