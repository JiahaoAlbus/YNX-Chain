import assert from "node:assert/strict";
import test from "node:test";
import {ed25519} from "@noble/curves/ed25519.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {createPayInvoiceSignerPolicy,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {parseSignedPayInvoice,signedPayInvoiceMaterial,verifySignedPayInvoice} from "./walletPaySignedInvoice";

// Deterministic synthetic keys ONLY, never user signing custody or live policy.
const seed=new Uint8Array(32).fill(7),otherSeed=new Uint8Array(32).fill(8);
const publicKey=bytesToHex(ed25519.getPublicKey(seed));
const id="inv_"+"a".repeat(20),now=Date.parse("2026-10-03T01:00:00Z");
const policy=createPayInvoiceSignerPolicy({schemaVersion:"ynx-pay-invoice-signers/v1",signers:[{keyId:"qa-key",publicKey,algorithm:"ed25519",merchantIds:["qa-merchant"]}]});
function fixture(version:number):Record<string,any>{return {version,id,centralInvoiceId:"qa-central",intentId:"qa-intent",merchantId:"qa-merchant",merchantName:"QA merchant",payoutAddress:ynxAddressFromEVM("0x"+"2".repeat(40)),amount:25,asset:"YNXT",network:"ynx_6423-1",fee:1,
  ...(version>=2?{feeBreakdown:{networkFee:1,providerCost:0,protocolFee:0,burn:0,treasury:0,merchantNet:25,sponsorCost:0,userRebate:0,source:"controlled-fixture",asOf:"2026-10-03T00:00:00Z",version:1}}:{}),
  ...(version>=3?{baseAmount:20,tipAmount:5}:{}),
  ...(version===4?{splitPaymentId:"spl_"+"b".repeat(20),splitShareId:"shr_"+"c".repeat(16),expectedPayerHash:"d".repeat(64)}:{}),
  ...(version===5?{serviceBillId:"qbl_"+"e".repeat(20),serviceEvidenceDigest:"f".repeat(64),expectedPayerHash:"d".repeat(64)}:{}),
  expiresAt:"2026-10-03T02:00:00Z",createdAt:"2026-10-03T00:00:00Z",signature:"0".repeat(128),signatureKeyId:"qa-key",signingPublicKey:publicKey,signatureAlgorithm:"ed25519"};}
// Independent transcription of original 53eb invoice wire order. Do not sign
// with the implementation under test: this detects wire-order regressions.
function originalMaterial(v:Record<string,any>):string{
  const parts=[`YNX_PAY_INVOICE_V${v.version}`,String(v.version),v.id,v.centralInvoiceId,v.intentId,v.merchantId,v.merchantName,v.payoutAddress,String(v.amount),v.asset,v.network,String(v.fee)];
  if(v.version>=2){const f=v.feeBreakdown;parts.push(...[f.networkFee,f.providerCost,f.protocolFee,f.burn,f.treasury,f.merchantNet,f.sponsorCost,f.userRebate,f.source,f.asOf,f.version].map(String));}
  if(v.version>=3)parts.push(String(v.baseAmount),String(v.tipAmount));
  parts.push(v.expiresAt,v.createdAt,v.signatureKeyId,v.signingPublicKey,v.signatureAlgorithm);
  if(v.version===4)parts.push(v.splitPaymentId,v.splitShareId,v.expectedPayerHash);
  if(v.version===5)parts.push(v.serviceBillId,v.serviceEvidenceDigest,v.expectedPayerHash);
  return parts.join("|");
}
function sign(v:Record<string,any>,key=seed):Record<string,any>{return {...v,signature:bytesToHex(ed25519.sign(new TextEncoder().encode(originalMaterial(v)),key))};}
for(const version of [1,2,3,4,5]){
  test(`v${version} preserves original wire and verifies independently pinned signer only`,()=>{
    const v=sign(fixture(version));assert.equal(signedPayInvoiceMaterial(parseSignedPayInvoice(v,id)),originalMaterial(v));
    const result=verifySignedPayInvoice(v,id,policy,()=>{},now);
    assert.equal(result.signatureVerified,true);assert.equal(result.quoteTimeCurrent,true);
    for(const key of ["paymentAuthorized","accountSessionVerified","settlementVerified"] as const)assert.equal(result[key],false);
    assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.invoice));
    if(version===1)assert.equal(result.invoice.feeBreakdown,undefined);
  });
  test(`v${version} binds all signed fields against tampering`,()=>{
    const v=sign(fixture(version));
    const changes:Record<string,unknown>[]=[{centralInvoiceId:"other-central"},{intentId:"other-intent"},{merchantName:"other merchant"},{payoutAddress:ynxAddressFromEVM("0x"+"3".repeat(40))},{createdAt:"2026-10-03T00:01:00Z"},{expiresAt:"2026-10-03T03:00:00Z"}];
    if(version>=2)changes.push({feeBreakdown:{...v.feeBreakdown,providerCost:1}});
    if(version>=3)changes.push({baseAmount:21,tipAmount:4});
    if(version===4)changes.push({splitShareId:"shr_"+"e".repeat(16)},{splitPaymentId:"spl_"+"f".repeat(20)},{expectedPayerHash:"a".repeat(64)});
    if(version===5)changes.push({serviceBillId:"qbl_"+"a".repeat(20)},{serviceEvidenceDigest:"a".repeat(64)},{expectedPayerHash:"a".repeat(64)});
    for(const change of changes)assert.throws(()=>verifySignedPayInvoice({...v,...change},id,policy,()=>{},now),/PAY_SIGNED_SIGNATURE_INVALID/);
  });
}
test("self-selected key, wrong merchant and unknown key ID cannot acquire trust",()=>{
  const v=fixture(2);
  for(const change of [{signingPublicKey:bytesToHex(ed25519.getPublicKey(otherSeed))},{merchantId:"other-merchant"},{signatureKeyId:"other-key"}]){
    const changed={...v,...change};assert.throws(()=>verifySignedPayInvoice(sign(changed,otherSeed),id,policy,()=>{},now),/independently registered/);
  }
  assert.throws(()=>verifySignedPayInvoice(sign(v),id,null as any,()=>{},now),/TRUST_POLICY_REQUIRED/);
});
test("unsigned status, descriptions and fabricated settlement never become trusted facts",()=>{
  const v=sign(fixture(5));const result=verifySignedPayInvoice({...v,status:"committed",description:"paid",settlement:{status:"committed"}},id,policy,()=>{},now);
  for(const key of ["status","description","settlement"])assert.equal(key in result.invoice,false);
  assert.equal(result.settlementVerified,false);assert.equal(result.paymentAuthorized,false);
});
test("expiry is a separate gate, never permission to pay",()=>{
  const v=sign(fixture(1));
  for(const time of [now-7_200_000,now+3_600_000]){const result=verifySignedPayInvoice(v,id,policy,()=>{},time);assert.equal(result.quoteTimeCurrent,false);assert.equal(result.paymentAuthorized,false);}
  for(const time of [NaN,Infinity,-1,8_640_000_000_000_001])assert.throws(()=>verifySignedPayInvoice(v,id,policy,()=>{},time));
});
test("account/lock guard is required before parsing and before returning verified data",()=>{
  const v=sign(fixture(1));let calls=0;
  assert.throws(()=>verifySignedPayInvoice(v,id,policy,()=>{if(++calls===2)throw Error("locked")},now),/locked/);assert.equal(calls,2);
  assert.throws(()=>verifySignedPayInvoice(null,id,policy,()=>{throw Error("locked")},now),/locked/);
});
test("ID, network, checksums, safe units, delimiters, dates and version-specific bindings fail closed",()=>{
  const v=fixture(5);
  const changes=[{id:"inv_"+"b".repeat(20)},{version:6},{version:"5"},{network:"evil"},{asset:"ETH"},{fee:0},{amount:0.1},{amount:Number.MAX_SAFE_INTEGER},{merchantName:"a|b"},{intentId:"a\nb"},{payoutAddress:v.payoutAddress.slice(0,-1)+"!"},{createdAt:"2026-02-30T00:00:00Z"},{expiresAt:v.createdAt},{baseAmount:20,tipAmount:4},{baseAmount:5,tipAmount:20},{serviceBillId:"invoice-qa"},{serviceEvidenceDigest:"z".repeat(64)},{expectedPayerHash:"0"},{signatureAlgorithm:"none"},{signature:"0"}];
  for(const change of changes)assert.throws(()=>parseSignedPayInvoice({...v,...change},id));
  for(const change of [{networkFee:2},{merchantNet:24},{providerCost:-1},{version:2}])assert.throws(()=>parseSignedPayInvoice({...v,feeBreakdown:{...v.feeBreakdown,...change}},id));
  const split=fixture(4);for(const change of [{splitPaymentId:"bad"},{splitShareId:"bad"},{expectedPayerHash:"bad"}])assert.throws(()=>parseSignedPayInvoice({...split,...change},id));
});
test("invalid signature cannot pass with correct registered key",()=>{
  assert.throws(()=>verifySignedPayInvoice(fixture(1),id,policy,()=>{},now),/SIGNATURE_INVALID/);
});
