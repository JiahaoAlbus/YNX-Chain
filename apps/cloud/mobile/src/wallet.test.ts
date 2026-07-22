import test from "node:test";
import assert from "node:assert/strict";
import {approvalFromURL,authorizationRequest,binding,requestURL,signGatewayChallenge} from "./wallet";

const decode=(value:string)=>JSON.parse(Buffer.from(value,"base64url").toString("utf8"));
const callback=(approval:unknown)=>`${binding.callback}?response=${Buffer.from(JSON.stringify(approval)).toString("base64url")}`;

test("Cloud uses canonical request envelope and device-bound completion",()=>{
  const issued=new Date("2026-07-16T00:00:00.000Z"),secret="42".repeat(32);
  const key="AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",request=authorizationRequest(key,"n".repeat(32),issued);
  assert.deepEqual(decode(new URL(requestURL(key,request.nonce,issued)).searchParams.get("request")!),request);
  assert.deepEqual(request.scopes,[...request.scopes].sort());
  const approval={version:"1",requestDigest:"a".repeat(64),nonce:request.nonce,chainId:request.chainId,requestingProduct:request.requestingProduct,productClientId:request.productClientId,bundleId:request.bundleId,productDeviceAlgorithm:request.productDeviceAlgorithm,productDeviceKey:request.productDeviceKey,callback:request.callback,account:"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",accountPublicKey:"02"+"0".repeat(64),grantedScopes:request.scopes,purpose:request.purpose,issuedAt:issued.toISOString(),expiresAt:request.expiresAt,walletSignature:"0".repeat(128)};
  assert.equal(approvalFromURL(callback(approval),request).account,approval.account);
  const challenge={version:"1",challenge:"gateway_challenge_abcdefghijklmnop",requestDigest:approval.requestDigest,productClientId:request.productClientId,bundleId:request.bundleId,productDeviceAlgorithm:"p256-sha256",productDeviceKey:key,account:approval.account,scopes:request.scopes,issuedAt:issued.toISOString(),expiresAt:new Date(issued.getTime()+180000).toISOString()};
  assert.match(signGatewayChallenge(secret,challenge).deviceSignature,/^[A-Za-z0-9_-]{90,96}$/);
  assert.throws(()=>approvalFromURL(callback({...approval,bundleId:"com.attacker"}),request),/bundleId mismatch/);
  assert.throws(()=>approvalFromURL(`${callback(approval)}&extra=1`,request),/callback mismatch/);
});
