#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  canonicalJSON, createGatewayChallenge, createProductDeviceIdentity, createProductSessionProof,
  encodeProductSessionProofHeader, httpBodyDigest, signAuthorization, signGatewayChallenge, walletIdentity,
} from "../vendor/wallet-auth/src/index.js";

const quant=(process.env.YNX_QUANT_E2E_URL??"http://127.0.0.1:6444/api").replace(/\/$/,"");
const exchange=(process.env.YNX_QUANT_E2E_EXCHANGE_URL??"http://127.0.0.1:6442/api").replace(/\/$/,"");
const admin=process.env.YNX_EXCHANGE_ADMIN_API_KEY;
if(!admin||admin.length<16)throw new Error("YNX_EXCHANGE_ADMIN_API_KEY is required for the isolated Testnet credit fixture");
const device=createProductDeviceIdentity(),accountSecret=validAccountSecret(),identity=walletIdentity(accountSecret),now=new Date(),tenant=randomBytes(32).toString("hex");
const authorizationRequest={version:"1",nonce:nonce(),chainId:"ynx_6423-1",requestingProduct:"quant",productClientId:"ynx-quant-v1",bundleId:"com.ynxweb4.quant",productDeviceAlgorithm:"p256-sha256",productDeviceKey:device.productDeviceKey,callback:"https://quant.ynxweb4.com/wallet-auth/callback",scopes:["quant:account","quant:mandate:create","quant:mandate:execute","quant:mandate:revoke"],purpose:"Automated canonical Wallet, Quant and Exchange Testnet verification",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300_000).toISOString()};
const walletApproval=signAuthorization(authorizationRequest,{accountSecret,account:identity.account,issuedAt:now.toISOString()}),challenge=createGatewayChallenge(walletApproval,{challenge:nonce(),expiresAt:new Date(now.getTime()+60_000).toISOString()},now),gatewayCompletion=signGatewayChallenge(challenge,device.productDeviceSecret);
let response=await fetch(`${quant}/v1/wallet/sessions/complete`,{method:"POST",headers:{"content-type":"application/json","X-YNX-Preview-Mode":"local-paper","X-YNX-Tenant-ID":tenant},body:canonicalJSON({authorizationRequest,walletApproval,gatewayCompletion})}),envelope=await response.json();
if(!response.ok||!envelope.ok||!envelope.result)throw new Error(`Quant Wallet completion failed closed (${response.status})`);
const session=envelope.result,proof=scope=>{const body=canonicalJSON({requiredScopes:[scope]}),issuedAt=new Date();return encodeProductSessionProofHeader(createProductSessionProof(session,{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest:httpBodyDigest(body),nonce:nonce(),issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+30_000).toISOString()},device.productDeviceSecret))};
const key=`quant-e2e-${Date.now()}-${randomBytes(5).toString("hex")}`;
response=await fetch(`${exchange}/v1/admin/test-credits`,{method:"POST",headers:{authorization:`Bearer ${admin}`,"content-type":"application/json"},body:JSON.stringify({account:identity.account,amountMicro:10_000_000,idempotencyKey:`${key}-credit`})});
if(response.status!==201)throw new Error(`Quant fixture credit failed closed (${response.status})`);
const strategyHash=randomBytes(32).toString("hex"),expiresAt=new Date(Date.now()+3_600_000),mandate={Account:identity.account,StrategyHash:strategyHash,Market:"YNXT-YUSD_TEST",ProductID:"ynx-quant-lab",BundleID:"com.ynxweb4.quant.web",DeviceID:`quant-web-${nonce()}`,NonceDomain:`quant:${strategyHash}`,Scope:"quant:testnet-execute",Nonce:Date.now(),MaxNotional:2_000_000,MaxPosition:2_000_000,MaxDailyLoss:500_000,MaxSlippageBPS:50,MaxGas:10_000,MaxOrdersPerMinute:10,MaxLeverageBPS:20_000,MaxDrawdown:500_000,MinLiquidity:2_000_000,MaxVaR:300_000,MaxExpectedShortfall:400_000,MaxDepegBPS:100,MaxConcentrationBPS:5_000,MaxCancelRateBPS:5_000,MaxConsecutiveAPIFailures:3,ExpiresAt:expiresAt.toISOString(),TestnetOnly:true};
const mandatePayload=["ynx-quant-execution-adapter-v2",identity.account,strategyHash,"YNXT-YUSD_TEST","ynx-quant-lab","com.ynxweb4.quant.web",mandate.DeviceID,"quant:testnet-execute","kill,read,reconcile,submit",String(mandate.Nonce),"2000000","2000000","500000","50","10000","10","20000","500000","2000000","300000","400000","100","5000","5000","3",expiresAt.toISOString().replace(/\.\d{3}Z$/,"Z"),`quant:${strategyHash}`,"true"].join("\n");
mandate.WalletSignature=sign(accountSecret,mandatePayload);const createProof=proof("quant:mandate:create");
response=await fetch(`${quant}/v1/testnet/mandates`,{method:"POST",headers:{"content-type":"application/json","X-YNX-Preview-Mode":"local-paper","X-YNX-Tenant-ID":tenant,"X-YNX-Quant-Product-Session-Proof":createProof},body:JSON.stringify(mandate)});const registered=await response.json();
if(response.status!==201||typeof registered.Digest!=="string")throw new Error(`Quant mandate failed closed (${response.status})`);
const orderKey=`${key}-order`,orderPayload=`ynx-exchange-order-v1\n${identity.account}\nYNXT-YUSD_TEST\nbuy\nlimit\n1000000\n1000000\n${orderKey}`,oracleAsOf=new Date().toISOString();
response=await fetch(`${quant}/v1/testnet/orders`,{method:"POST",headers:{"content-type":"application/json","X-YNX-Preview-Mode":"local-paper","X-YNX-Tenant-ID":tenant,"X-YNX-Quant-Product-Session-Proof":proof("quant:mandate:execute")},body:JSON.stringify({MandateDigest:registered.Digest,Side:"buy",Price:1_000_000,Amount:1_000_000,IdempotencyKey:orderKey,WalletSignature:sign(accountSecret,orderPayload),Risk:{referencePrice:1_000_000,estimatedGas:1_000,observedDailyLoss:0,equity:10_000_000,grossExposure:0,peakEquity:10_000_000,currentEquity:10_000_000,availableLiquidity:10_000_000,depegBps:0,concentrationBps:1_000,ordersObserved:0,cancelsObserved:0,consecutiveApiFailures:0,var:100_000,expectedShortfall:150_000,oracleAsOf,venueHealthy:true}})});const order=await response.json();
if(response.status!==201||order.status!=="submitted_testnet"||!order.brokerProof)throw new Error(`Quant order failed closed (${response.status})`);
response=await fetch(`${exchange}/v1/quant-adapter/account`,{method:"POST",headers:{"content-type":"application/json","X-YNX-Product-Session-Proof":createProof},body:"{}"});
if(response.status!==401)throw new Error(`Consumed Quant Product Session proof replay was not rejected (${response.status})`);
process.stdout.write(`${canonicalJSON({account:identity.account,accountPublicKeyBound:session.accountPublicKey===identity.accountPublicKey,mandateDigest:registered.Digest,ok:true,quantOrderId:order.id,quantOrderStatus:order.status,replayStatus:response.status})}\n`);
function nonce(){return randomBytes(24).toString("base64url")}
function validAccountSecret(){for(;;){const value=randomBytes(32).toString("hex");try{walletIdentity(value);return value}catch{}}}
function sign(secret,payload){return bytesToHex(secp256k1.sign(sha256(utf8ToBytes(payload)),hexToBytes(secret),{prehash:false,format:"compact",lowS:true}))}
