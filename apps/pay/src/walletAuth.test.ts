import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { authorizationDeepLink, canonicalJSON, createAuthorizationRequest, createGatewayCompletion, deviceSecret, parsePaymentResultCallback, paymentIntent, paymentIntentDigest, requestDigest, verifyAuthorization } from "./walletAuth";

const now=new Date("2026-07-16T01:00:00.000Z"),accountSecret=new Uint8Array(32).fill(0);accountSecret[31]=1;
const deviceBytes=new Uint8Array(32).fill(0x42),device=deviceSecret(deviceBytes),account="ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",accountPublicKey=bytesToHex(secp256k1.getPublicKey(accountSecret,true));

test("Pay uses the strict Wallet request envelope and P-256 Gateway completion",()=>{
  const request=createAuthorizationRequest(device,new Uint8Array(24).fill(0x11),now);
  assert.match(authorizationDeepLink(request),/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/);
  const approvalBase={version:"1" as const,requestDigest:requestDigest(request),nonce:request.nonce,chainId:request.chainId,requestingProduct:request.requestingProduct,productClientId:request.productClientId,bundleId:request.bundleId,productDeviceAlgorithm:request.productDeviceAlgorithm,productDeviceKey:request.productDeviceKey,callback:request.callback,account,accountPublicKey,grantedScopes:request.scopes,purpose:request.purpose,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+240_000).toISOString()};
  const walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(`YNX_WALLET_AUTH_APPROVAL_V1\n${canonicalJSON(approvalBase)}`)),accountSecret,{prehash:false,format:"compact",lowS:true}));
  const approval=verifyAuthorization({...approvalBase,walletSignature},request,now);
  const completion=createGatewayCompletion(approval,device,new Uint8Array(24).fill(0x22),now);
  assert.equal(completion.challenge.productDeviceKey,request.productDeviceKey);
  assert.ok(p256.verify(Buffer.from(completion.deviceSignature,"base64url"),utf8ToBytes(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(completion.challenge)}`),p256.getPublicKey(deviceBytes,true),{format:"der",lowS:false}));
  assert.throws(()=>verifyAuthorization({...approval,productClientId:"attacker"},request,now),/match/);
});

test("signed payment result is bound to exact quote, account and transaction",()=>{
  const intent=paymentIntent({requestId:"payment_request_abcdefghijklmnop",sessionBinding:"a".repeat(64),invoiceId:"inv_"+"a".repeat(20),centralInvoiceId:"abcdef0123456789abcdef01",merchantId:"mrc_"+"b".repeat(20),merchantName:"Merchant",payoutAddress:account,amount:12,asset:"YNXT",fee:1,total:13,quoteIssuedAt:now.toISOString(),quoteExpiresAt:new Date(now.getTime()+180_000).toISOString(),invoiceSignature:"c".repeat(128)});
  const base={version:"1" as const,intentDigest:paymentIntentDigest(intent),requestId:intent.requestId,invoiceId:intent.invoiceId,chainId:intent.chainId,account,accountPublicKey,transactionHash:"0x"+"d".repeat(64),issuedAt:new Date(now.getTime()+60_000).toISOString()};
  const walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(`YNX_PAY_WALLET_RESULT_V1\n${canonicalJSON(base)}`)),accountSecret,{prehash:false,format:"compact",lowS:true}));
  const response=Buffer.from(canonicalJSON({...base,walletSignature})).toString("base64url");
  assert.equal(parsePaymentResultCallback(`ynxpay://payment-result?response=${response}`,intent,account,new Date(now.getTime()+60_000)).transactionHash,base.transactionHash);
  assert.throws(()=>parsePaymentResultCallback(`ynxpay://payment-result?response=${Buffer.from(canonicalJSON({...base,transactionHash:"0x"+"e".repeat(64),walletSignature})).toString("base64url")}`,intent,account,new Date(now.getTime()+60_000)),/signature/);
});
