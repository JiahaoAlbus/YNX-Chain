import {test} from "node:test";
import assert from "node:assert/strict";
import {ed25519} from "@noble/curves/ed25519.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {createPayInvoiceSignerPolicy,ynxAddressFromEVM,payPaymentIntentDigest} from "@ynx-chain/wallet-auth";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyWalletPayQuote} from "./walletPayQuote";
import {WalletPayInvoiceClient} from "./walletPayInvoice";
const now=Date.parse("2026-10-03T01:00:00Z"),seed=new Uint8Array(32).fill(11),publicKey=bytesToHex(ed25519.getPublicKey(seed));
const configuration={schemaVersion:"ynx-pay-invoice-signers/v1",signers:[{keyId:"controlled-quote-key",publicKey,algorithm:"ed25519",merchantIds:["controlled-merchant"]}]};
const policy=createPayInvoiceSignerPolicy(configuration);
function fixture(version=1){
  const invoice={version:1,id:"inv_"+"a".repeat(20),centralInvoiceId:"controlled-central",intentId:"controlled-intent",merchantId:"controlled-merchant",merchantName:"Controlled merchant",payoutAddress:ynxAddressFromEVM("0x"+"2".repeat(40)),amount:25,asset:"YNXT",network:"ynx_6423-1",fee:1,expiresAt:"2026-10-03T02:00:00Z",createdAt:"2026-10-03T00:00:00Z",signature:"",signatureKeyId:"controlled-quote-key",signingPublicKey:publicKey,signatureAlgorithm:"ed25519"};
  const original:Record<string,any>=invoice;original.version=version;
  if(version>=2)original.feeBreakdown={networkFee:1,providerCost:0,protocolFee:0,burn:0,treasury:0,merchantNet:25,sponsorCost:0,userRebate:0,source:"controlled-fixture",asOf:"2026-10-03T00:00:00Z",version:1};
  if(version>=3){original.baseAmount=20;original.tipAmount=5;}
  if(version===4){original.splitPaymentId="spl_"+"c".repeat(20);original.splitShareId="shr_"+"d".repeat(16);original.expectedPayerHash="e".repeat(64);}
  if(version===5){original.serviceBillId="qbl_"+"c".repeat(20);original.serviceEvidenceDigest="d".repeat(64);original.expectedPayerHash="e".repeat(64);}
  // Independent original V1–V5 wire transcription, not the verifier's serializer.
  const parts=[`YNX_PAY_INVOICE_V${version}`,version,invoice.id,invoice.centralInvoiceId,invoice.intentId,invoice.merchantId,invoice.merchantName,invoice.payoutAddress,invoice.amount,invoice.asset,invoice.network,invoice.fee];
  if(version>=2){const f=original.feeBreakdown;parts.push(f.networkFee,f.providerCost,f.protocolFee,f.burn,f.treasury,f.merchantNet,f.sponsorCost,f.userRebate,f.source,f.asOf,f.version);}
  if(version>=3)parts.push(original.baseAmount,original.tipAmount);
  parts.push(invoice.expiresAt,invoice.createdAt,invoice.signatureKeyId,invoice.signingPublicKey,invoice.signatureAlgorithm);
  if(version===4)parts.push(original.splitPaymentId,original.splitShareId,original.expectedPayerHash);
  if(version===5)parts.push(original.serviceBillId,original.serviceEvidenceDigest,original.expectedPayerHash);
  const material=parts.join("|");
  invoice.signature=bytesToHex(ed25519.sign(new TextEncoder().encode(material),seed));
  const intent={version:"1",intentType:"pay.ynxt.transfer",requestId:"r".repeat(32),chainId:"ynx_6423-1",productClientId:"ynx-pay-v1",bundleId:"com.ynxweb4.pay",sessionBinding:"b".repeat(64),invoiceId:invoice.id,centralInvoiceId:invoice.centralInvoiceId,merchantId:invoice.merchantId,merchantName:invoice.merchantName,payoutAddress:invoice.payoutAddress,amount:25,asset:"YNXT",fee:1,total:26,quoteIssuedAt:"2026-10-03T01:00:00.000Z",quoteExpiresAt:"2026-10-03T01:01:00.000Z",invoiceSignature:invoice.signature,callback:"ynxpay://payment-result"};
  return{invoice,intent};
}
test("original signed merchant invoice binds a current canonical quote without claiming account session or payment",()=>{
  const {invoice,intent}=fixture(),result=verifyWalletPayQuote(invoice,intent,policy,()=>{},now);
  assert.equal(result.signatureVerified,true);assert.equal(result.quoteBound,true);assert.equal(result.intentDigest,payPaymentIntentDigest(result.intent));
  for(const key of ["accountSessionVerified","paymentAuthorized","settlementVerified"] as const)assert.equal(result[key],false);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.invoice));assert.ok(Object.isFrozen(result.intent));
});
for(const version of [2,3,4,5])test(`original V${version} quote preserves signed detail without inferring payer authorization`,()=>{
  const f=fixture(version),result=verifyWalletPayQuote(f.invoice,f.intent,policy,()=>{},now);
  assert.equal(result.invoice.version,version);assert.equal(result.quoteBound,true);
  assert.equal(result.accountSessionVerified,false);assert.equal(result.paymentAuthorized,false);
  assert.equal(result.invoice.feeBreakdown?.merchantNet,25);
  if(version>=3){assert.equal(result.invoice.baseAmount,20);assert.equal(result.invoice.tipAmount,5);}
  if(version>=4)assert.equal(result.invoice.expectedPayerHash,"e".repeat(64));
});
test("a context invalidated at final return cannot receive a verified quote",()=>{
  const f=fixture();let calls=0;
  assert.throws(()=>verifyWalletPayQuote(f.invoice,f.intent,policy,()=>{if(++calls===4)throw Error("account changed")},now),/account changed/);
  assert.equal(calls,4);
});
const mutations=[{centralInvoiceId:"other-central"},{merchantId:"other-merchant"},{merchantName:"Other merchant"},{payoutAddress:ynxAddressFromEVM("0x"+"3".repeat(40))},{amount:26,total:27},{invoiceSignature:"0".repeat(128)},{chainId:"other-chain"},{asset:"other-asset"},{fee:2,total:27},{callback:"https://evil.invalid"},{sessionBinding:"invalid"}];
for(const mutation of mutations)test(`quote cannot substitute ${Object.keys(mutation).join("/")}`,()=>{const f=fixture();assert.throws(()=>verifyWalletPayQuote(f.invoice,{...f.intent,...mutation},policy,()=>{},now))});
test("quote cannot outlive a merchant invoice even when both signatures and SDK quote time are independently valid",()=>{
  const f=fixture();assert.throws(()=>verifyWalletPayQuote(f.invoice,{...f.intent,quoteIssuedAt:"2026-10-03T01:59:00.000Z",quoteExpiresAt:"2026-10-03T02:01:00.000Z"},policy,()=>{},Date.parse("2026-10-03T01:59:00Z")),/LIFETIME_MISMATCH/);
});
test("merchant policy is mandatory, forged invoice and cancelled context cannot yield a bound quote",()=>{
  const f=fixture();assert.throws(()=>verifyWalletPayQuote(f.invoice,f.intent,undefined as any,()=>{},now),/TRUST_POLICY_REQUIRED/);
  assert.throws(()=>verifyWalletPayQuote({...f.invoice,amount:26},f.intent,policy,()=>{},now),/SIGNATURE_INVALID/);
  assert.throws(()=>verifyWalletPayQuote(f.invoice,f.intent,policy,()=>{throw Error("cancelled")},now),/cancelled/);
});
test("Native and Desktop quote bindings agree on original signed input and every substitution",()=>{
  const f=fixture(),rows=[...[1,2,3,4,5].map(version=>({...fixture(version),valid:true})),...mutations.map(mutation=>({invoice:f.invoice,intent:{...f.intent,...mutation},valid:false}))];
  const moduleURL=pathToFileURL(resolve("../wallet-desktop/src/wallet-pay-quote.mjs")).href;
  const script=`import {verifyWalletPayQuote} from ${JSON.stringify(moduleURL)};import {createPayInvoiceSignerPolicy} from '@ynx-chain/wallet-auth';import {readFileSync} from 'node:fs';const data=JSON.parse(readFileSync(0,'utf8')),policy=createPayInvoiceSignerPolicy(data.configuration);console.log(JSON.stringify(data.rows.map(row=>{try{return verifyWalletPayQuote(row.invoice,row.intent,policy,()=>{},data.now).quoteBound}catch{return false}})));`;
  const actual=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",script],{cwd:resolve("../wallet-desktop"),input:JSON.stringify({rows,configuration,now}),encoding:"utf8"}));
  assert.deepEqual(actual,rows.map(row=>row.valid));
});
test("signed invoice client reads the exact original product route and preserves all signed versions",async()=>{
  for(const version of [1,2,3,4,5]){
    const f=fixture(version);let reads=0;
    const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async(url,options)=>{
      reads++;assert.equal(url,`https://api.ynxweb4.com/app/pay-product/v1/invoices/${f.invoice.id}`);
      assert.equal(options.method,"GET");assert.equal(options.redirect,"error");assert.equal(options.credentials,"omit");
      return new Response(JSON.stringify({...f.invoice,status:"committed",settlement:{status:"committed"}}));
    });
    const verified=await client.signedInvoice(f.invoice.id,policy,()=>{},undefined,()=>now);
    assert.equal(reads,1);assert.equal(verified.invoice.version,version);assert.equal(verified.signatureVerified,true);
    assert.equal(verified.paymentAuthorized,false);assert.equal(verified.accountSessionVerified,false);
    assert.equal("status" in verified.invoice,false);assert.equal("settlement" in verified.invoice,false);
  }
});
test("missing protected policy and noncanonical signed ID fail before any HTTP read",async()=>{
  let reads=0;const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>{reads++;throw Error("must not fetch")});
  await assert.rejects(client.signedInvoice(fixture().invoice.id,undefined as any,()=>{}),/TRUST_POLICY_REQUIRED/);
  await assert.rejects(client.signedInvoice("legacy-invoice",policy,()=>{}),/INVALID_INVOICE/);
  assert.equal(reads,0);
});
test("signed invoice fetch cannot publish after account context cancellation or accept a service-selected signer",async()=>{
  const f=fixture();let current=true;
  const client=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>{current=false;return new Response(JSON.stringify(f.invoice))});
  await assert.rejects(client.signedInvoice(f.invoice.id,policy,()=>{if(!current)throw Error("account changed")},undefined,()=>now),/account changed/);
  const forged=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Response(JSON.stringify({...f.invoice,signingPublicKey:"a".repeat(64)})));
  await assert.rejects(forged.signedInvoice(f.invoice.id,policy,()=>{},undefined,()=>now));
});
test("Desktop original signed-invoice transport agrees on all five Native signed wires",()=>{
  const moduleURL=pathToFileURL(resolve("../wallet-desktop/src/wallet-pay-invoice-reference.mjs")).href;
  const rows=[1,2,3,4,5].map(version=>fixture(version).invoice);
  const script=`import {WalletPayInvoiceClient} from ${JSON.stringify(moduleURL)};import {createPayInvoiceSignerPolicy} from '@ynx-chain/wallet-auth';import {readFileSync} from 'node:fs';const data=JSON.parse(readFileSync(0,'utf8')),policy=createPayInvoiceSignerPolicy(data.configuration);const results=[];for(const invoice of data.rows){const client=new WalletPayInvoiceClient('https://api.ynxweb4.com',async(url,options)=>{if(url!=='https://api.ynxweb4.com/app/pay-product/v1/invoices/'+invoice.id||options.method!=='GET'||options.credentials!=='omit'||options.redirect!=='error')throw Error('route mismatch');return new Response(JSON.stringify(invoice))});results.push(await client.signedInvoice(invoice.id,policy,()=>{},undefined,()=>data.now))}console.log(JSON.stringify(results));`;
  const actual=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",script],{cwd:resolve("../wallet-desktop"),input:JSON.stringify({rows,configuration,now}),encoding:"utf8"}));
  assert.deepEqual(actual,rows.map(invoice=>({invoice:verifyWalletPayQuote(invoice,{...fixture(invoice.version).intent},policy,()=>{},now).invoice,signatureVerified:true,checkedAt:new Date(now).toISOString(),quoteTimeCurrent:true,paymentAuthorized:false,accountSessionVerified:false,settlementVerified:false,truthfulStatus:"pinned-merchant-signature-only-not-payment-authorization"})));
});
