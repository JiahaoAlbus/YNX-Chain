import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  cardProviderDetailsHash, cardProviderRequestBindingHash, createCardApplicationApprovalRequest,
  createCardApplicationApprovalReturnURL, createSignedCardApplicationApproval,
  encodeCardApplicationApprovalWalletURL, parseCardApplicationApprovalRequest,
  parseCardApplicationApprovalReturnURL, parseCardApplicationApprovalWalletURL,
  verifySignedCardApplicationApproval, walletIdentity,
} from "../src/index.js";

const registry=JSON.parse(readFileSync(new URL("../product-session-registry.json",import.meta.url),"utf8"));
const secret="0".repeat(63)+"1",account=walletIdentity(secret).account,now=new Date("2026-09-25T12:00:00.000Z");
const sha=value=>createHash("sha256").update(value,"utf8").digest("hex");
const feeDisclosureText="TEST environment only. Virtual card application fee: 0 USD. No real funds or card are issued.";
const details={productCardId:"card-test-001",principalOwner:account,provider:"sandbox_provider",programId:"virtual_test",environment:"TEST",externalAccountBindingHash:"a".repeat(64),appChain:"ynx_6423-1",fundingNetwork:"eip155:84532",fundingAssetId:"test-usdc-84532",tokenContract:"0x"+"1".repeat(40),decimals:6,testSpendingLimitMinor:"10000",cardAccountCurrency:"USD",minorUnitDigits:2,termsVersion:"test-terms-v1",termsHash:"b".repeat(64),riskVersion:"test-risk-v1",riskHash:"c".repeat(64),feeDisclosureVersion:"test-fees-v1",feeDisclosureText,feeDisclosureHash:sha(feeDisclosureText),idempotencyKey:"11111111-1111-4111-8111-111111111111"};
const challenge={id:"challenge_22222222-2222-4222-8222-222222222222",applicationId:"application_33333333-3333-4333-8333-333333333333",owner:account,chainId:"0x1917",purpose:"create-provider-test-card",payloadHash:cardProviderDetailsHash(details),nonce:"44444444-4444-4444-8444-444444444444",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString()};
const input={productId:"card",platform:"android",account,challenge,details,requestId:"55555555-5555-4555-8555-555555555555",state:"s".repeat(32)};

test("provider test-card consent binds complete details, request origin and callback",()=>{
  const request=createCardApplicationApprovalRequest(registry,input,now);
  assert.equal(request.version,"2");
  assert.equal(request.productId,"card");
  assert.equal(request.challenge.requestBindingHash,cardProviderRequestBindingHash(request));
  const url=encodeCardApplicationApprovalWalletURL(registry,request,now);
  assert.deepEqual(parseCardApplicationApprovalWalletURL(registry,url,now),request);
  const approval=createSignedCardApplicationApproval({accountSecret:secret,challenge:request.challenge,details:request.details},new Date(now.getTime()+1_000));
  assert.equal(approval.version,"2");
  assert.deepEqual(verifySignedCardApplicationApproval(approval,{challenge:request.challenge,details:request.details,account},new Date(now.getTime()+2_000)),approval);
  const returned=createCardApplicationApprovalReturnURL(registry,request,{status:"approved",approval},new Date(now.getTime()+2_000));
  assert.equal(parseCardApplicationApprovalReturnURL(registry,returned,request,new Date(now.getTime()+2_000)).status,"approved");
  assert.equal(parseCardApplicationApprovalReturnURL(registry,createCardApplicationApprovalReturnURL(registry,request,{status:"rejected",reason:"USER_REJECTED"},now),request,now).status,"rejected");
});

test("provider consent fails closed on fee, owner, request, environment and purpose tampering",()=>{
  const request=createCardApplicationApprovalRequest(registry,input,now);
  const parse=value=>parseCardApplicationApprovalRequest(registry,value,now);
  assert.throws(()=>parse({...request,details:{...request.details,feeDisclosureText:"A different fee"}}),/hash|details/i);
  assert.throws(()=>parse({...request,details:{...request.details,principalOwner:walletIdentity("0".repeat(63)+"2").account}}),/owner|account/i);
  assert.throws(()=>parse({...request,requestId:"66666666-6666-4666-8666-666666666666"}),/bind/i);
  assert.throws(()=>parse({...request,callback:"https://attacker.example/callback"}),/callback/i);
  assert.throws(()=>parse({...request,details:{...request.details,environment:"LIVE"}}),/environment/i);
  assert.throws(()=>parse({...request,challenge:{...request.challenge,purpose:"create-testnet-card"}}),/schema|purpose|version/i);
  assert.throws(()=>parse({...request,unknownField:true}),/schema/i);
  assert.throws(()=>parseCardApplicationApprovalRequest(registry,request,new Date(now.getTime()+300_001)),/expired|current/i);
});
