import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {createTronReceiveCode,publicTronAddress} from '../src/multichain-tron-receive.mjs';
const address='TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
function fixture(){let context={account:'PUBLIC',revision:1,locked:false,authenticating:false},revision=0;
  const input={family:'tron',network:'nile',vaultAccount:'PUBLIC',address,revision:1};
  const dependencies={getContext:async()=>({...context}),readNetworks:async()=>({revision,networks:[{family:'tron',network:'nile',genesis:'a'.repeat(64),rpcUrl:'https://public.example'}]}),readAccount:async()=>({...input,index:0,account:0,path:"m/44'/195'/0'/0/0"})};
  return {input,dependencies,change:value=>Object.assign(context,value),config:()=>revision++};}
test('TRON code contains exact bare public address and matches local QR matrix',async()=>{const f=fixture(),code=await createTronReceiveCode(f.input,f.dependencies),qr=QRCode.create(address,{errorCorrectionLevel:'M'});assert.equal(code.payload,address);assert.equal(code.size,qr.modules.size);assert.deepEqual(code.modules,Array.from(qr.modules.data));assert.equal(code.configRevision,0);});
test('public TRON address checksum rejects mistyped address',()=>{assert.equal(publicTronAddress(address),address);assert.throws(()=>publicTronAddress(address.slice(0,-1)+'9'));});
for(const boundary of ['locked','authenticating','account','revision','config'])test(`producer fences ${boundary} after public account read`,async()=>{const f=fixture(),original=f.dependencies.readAccount;f.dependencies.readAccount=async()=>{const result=await original();if(boundary==='config')f.config();else f.change({[boundary]:boundary==='account'?'OTHER':boundary==='revision'?2:true});return result;};await assert.rejects(createTronReceiveCode(f.input,f.dependencies),/FAMILY_ACCOUNT_CHANGED/);});
test('accessor input is rejected without executing getter',async()=>{const f=fixture();let calls=0;Object.defineProperty(f.input,'address',{get(){calls++;return address;},enumerable:true});await assert.rejects(createTronReceiveCode(f.input,f.dependencies));assert.equal(calls,0);});
test('derived path or vault mismatch cannot produce QR',async()=>{const f=fixture();f.dependencies.readAccount=async()=>({...f.input,index:0,account:0,path:"m/44'/195'/0'/0/1"});await assert.rejects(createTronReceiveCode(f.input,f.dependencies));});
