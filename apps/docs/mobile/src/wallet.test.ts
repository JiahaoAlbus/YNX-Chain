import test from "node:test";
import assert from "node:assert/strict";
import {approvalFromURL,authorizationRequest,binding,requestURL} from "./wallet";

const decode=(value:string)=>JSON.parse(Buffer.from(value,"base64url").toString("utf8"));
const callback=(approval:unknown)=>`${binding.callback}?response=${Buffer.from(JSON.stringify(approval)).toString("base64url")}`;

test("Docs canonical Wallet intent is isolated and substitution-safe",()=>{
  const issued=new Date("2026-07-16T00:00:00.000Z"),key="AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",request=authorizationRequest(key,"d".repeat(32),issued);
  assert.deepEqual(decode(new URL(requestURL(key,request.nonce,issued)).searchParams.get("request")!),request);
  assert.equal(request.requestingProduct,"docs");assert.deepEqual(request.scopes,[...request.scopes].sort());assert(request.scopes.length<=8);
  const approval={version:"1",requestDigest:"a".repeat(64),nonce:request.nonce,chainId:request.chainId,requestingProduct:request.requestingProduct,productClientId:request.productClientId,bundleId:request.bundleId,productDeviceAlgorithm:request.productDeviceAlgorithm,productDeviceKey:request.productDeviceKey,callback:request.callback,account:"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",accountPublicKey:"02"+"0".repeat(64),grantedScopes:request.scopes,purpose:request.purpose,issuedAt:issued.toISOString(),expiresAt:request.expiresAt,walletSignature:"0".repeat(128)};
  assert.equal(approvalFromURL(callback(approval),request).account,approval.account);
  assert.throws(()=>approvalFromURL(callback({...approval,callback:"attacker://wallet-auth/callback"}),request),/callback mismatch/);
  assert.throws(()=>approvalFromURL(callback({...approval,grantedScopes:["account:read"]}),request),/proof or scopes invalid/);
});
