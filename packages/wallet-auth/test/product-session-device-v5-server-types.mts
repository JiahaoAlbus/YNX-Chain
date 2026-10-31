import{ProductSessionGatewayNodeHost,readOriginalDeveloperHTTPCredential}from'../src/product-session-gateway-node-host.js';
import type{OriginalDeveloperHTTPBinaryRequestV5,OriginalAccountPolicyBinaryV5Runner,OriginalAccountPolicyBinaryV5Operation,OriginalDeveloperHTTPCredential}from'../src/product-session-gateway-node-host.js';
import{verifyOriginalProductSessionHTTPProofV5}from'../src/product-session-device-v5.js';
declare const host:ProductSessionGatewayNodeHost,input:OriginalDeveloperHTTPBinaryRequestV5,operation:OriginalAccountPolicyBinaryV5Operation;
const credential:OriginalDeveloperHTTPCredential=await host.authenticateOriginalDeveloperHTTPRequestV5(input);await host.revalidateOriginalDeveloperHTTPRequestV5(input);await readOriginalDeveloperHTTPCredential(credential);const bytes:Uint8Array=operation.bodyOriginal;const method:'POST'=operation.method;void[bytes,method];
const runner:OriginalAccountPolicyBinaryV5Runner=async(original,execute)=>{const length:string=original.bodyBinding.bytes;void length;void execute;};void runner;
// @ts-expect-error Binary account current has no fake empty UTF8 body.
operation.body;
// @ts-expect-error Existing V4 text input is not a V5 binary request.
host.authenticateOriginalDeveloperHTTPRequestV5({requestId:'x',method:'POST',path:'/api/v1/ide/deployments',body:'',proofHeader:'x'});
// @ts-expect-error No DTO -> original credential promotion.
const forged:OriginalDeveloperHTTPCredential={authorized:true};void forged;
// @ts-expect-error No Source/current/replay injection via approved boolean.
verifyOriginalProductSessionHTTPProofV5({approved:true});
