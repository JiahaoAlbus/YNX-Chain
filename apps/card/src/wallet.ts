import { p256 } from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth";
import {
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type GatewayChallenge,
} from "@ynx-chain/wallet-auth";

type WalletRequest = {method:string;params?:readonly unknown[]};
type WalletRequestResult = {error?:{code?:number;message?:string}};

type EIP1193Provider = Readonly<{request:(args:WalletRequest)=>Promise<unknown>}>;
export type Eip1193Provider=EIP1193Provider;

const encodeBase64url=(WalletAuth as unknown as {encodeBase64url:(value:Uint8Array)=>string}).encodeBase64url;

export const PRODUCT_ID="ynx-card";
export const CLIENT_ID="ynx-card-v1";
export const BUNDLE_ID="com.ynxweb4.card";
export const CALLBACK="ynxcard://wallet-auth/callback";
export const SCOPES=Object.freeze(["account:read","card:application:write","card:controls:write","card:dispute:write"] as const);
export const YNX_TESTNET_CHAIN_ID="0x1917";
export const YNX_TESTNET_CHAIN_NAME="YNX Testnet";

export type PendingAuthorization=Readonly<{request:AuthorizationRequest;deviceSecret:string}>;
export type CardSession=Readonly<{token:string;sessionBinding:string;requestDigest:string;account:string;productClientId:"ynx-card-v1";bundleId:"com.ynxweb4.card";scopes:readonly string[];issuedAt:string;expiresAt:string;deviceId:string}>;
export type Eip1193WalletSession=Readonly<{address:string;chainId:string;connectedAt:string;provider:"eip1193"}>;
export type TopupEvidence=Readonly<{chainId:string;txHash:string;blockNumber:string;blockHash:string;from:string;to:string}>;

const ynxChainParameters={chainId:YNX_TESTNET_CHAIN_ID,chainName:YNX_TESTNET_CHAIN_NAME,nativeCurrency:{name:"YNX",symbol:"YNXT",decimals:18},rpcUrls:[],blockExplorerUrls:[]};

const registry:{[productClient:string]:{requestingProduct:string;bundleId:string;callbacks:string[];scopes:readonly string[];maxScopes:number}}={
  [CLIENT_ID]:{requestingProduct:PRODUCT_ID,bundleId:BUNDLE_ID,callbacks:[CALLBACK],scopes:[...SCOPES],maxScopes:SCOPES.length},
};

export async function createAuthorization(now=new Date(),random?:Readonly<{secret:Uint8Array;nonce:Uint8Array}>):Promise<PendingAuthorization>{
  const generated=random??await productRandom();
  const secret=generated.secret;
  const nonce=encodeBase64url(generated.nonce);
  const publicKey=encodeBase64url(p256.getPublicKey(secret,true));
  const request=parseAuthorizationRequest({
    version:"1",nonce,chainId:"ynx_6423-1",requestingProduct:PRODUCT_ID,productClientId:CLIENT_ID,bundleId:BUNDLE_ID,
    productDeviceAlgorithm:"p256-sha256",productDeviceKey:publicKey,callback:CALLBACK,scopes:[...SCOPES],
    purpose:"Check card eligibility and manage this account's sandbox card controls and disputes.",
    issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+5*60_000).toISOString(),
  },{now,registry});
  return Object.freeze({request,deviceSecret:encodeBase64url(secret)});
}

export function walletDeepLink(pending:PendingAuthorization):string{return encodeRequestDeepLink(pending.request)}

export async function completeCentralSession(gatewayURL:string,pending:PendingAuthorization,approval:AuthorizationResponse):Promise<CardSession>{
  const base=requiredGateway(gatewayURL);
  const challenge=await json(`${base}/app/card/session/challenges`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval}}) as {challenge:GatewayChallenge};
  const completion=signGatewayChallenge(challenge.challenge,pending.deviceSecret);
  const value=await json(`${base}/app/card/session/complete`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval,gatewayCompletion:completion}});
  return parseSession(value);
}

export function verifiedApproval(callbackURL:string,pending:PendingAuthorization,now=new Date()):AuthorizationResponse{
  const raw=parseCallbackURL(callbackURL,CALLBACK);
  return verifyAuthorization(raw,{...pending.request,requestDigest:requestDigest(pending.request),now});
}

export function resolveEip1193Provider():Eip1193Provider|null{
  const globalWallet=(globalThis as {ethereum?:unknown}).ethereum;
  if(object(globalWallet)&&typeof (globalWallet as {request?:unknown}).request==="function"){
    return globalWallet as Eip1193Provider;
  }
  return null;
}

export async function connectEip1193Wallet(provider:Eip1193Provider|null=resolveEip1193Provider(),now=new Date()):Promise<Eip1193WalletSession>{
  if(!provider) throw new Error("EIP-1193 wallet provider is not available");
  const requestAccounts=await provider.request({method:"eth_requestAccounts",params:[]}).catch((error:WalletRequestResult)=>{throw new Error(error?.error?.message??"Wallet account request rejected")});
  if(!Array.isArray(requestAccounts)||typeof requestAccounts[0]!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(requestAccounts[0])) throw new Error("Wallet returned an invalid account");
  const address=requestAccounts[0].toLowerCase();

  const requestedChain=String(await provider.request({method:"eth_chainId",params:[]})??"");
  if(requestedChain!==YNX_TESTNET_CHAIN_ID){
    try{
      await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_TESTNET_CHAIN_ID}]});
    }catch(error:unknown){
      const code=(error as WalletRequestResult).error?.code;
      if(code===4902||code===-32603){
        await provider.request({method:"wallet_addEthereumChain",params:[ynxChainParameters]});
        await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_TESTNET_CHAIN_ID}]});
      }else{
        throw error instanceof Error?error:new Error("Wallet is not connected to YNX Testnet");
      }
    }
  }
  const chainId=String(await provider.request({method:"eth_chainId",params:[]})??"");
  if(chainId!==YNX_TESTNET_CHAIN_ID) throw new Error("Wallet is not connected to YNX Testnet");

  return Object.freeze({address,chainId,connectedAt:now.toISOString(),provider:"eip1193"});
}

export async function loadTestnetTopupEvidence(provider:Eip1193Provider,txHash:string):Promise<TopupEvidence>{
  if(!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Top-up transaction hash must be 0x-prefixed");
  const tx=await provider.request({method:"eth_getTransactionByHash",params:[txHash]});
  const receipt=await provider.request({method:"eth_getTransactionReceipt",params:[txHash]});
  if(!object(tx)||!object(receipt)||typeof (receipt as {blockHash?:unknown}).blockHash!=="string"||typeof tx.from!=="string"||typeof tx.to!=="string"||typeof tx.blockNumber!="string") throw new Error("Could not read chain evidence");
  const chainId=String((await provider.request({method:"eth_chainId",params:[]})??""));
  if(chainId!==YNX_TESTNET_CHAIN_ID) throw new Error("Top-up transaction is not on YNX Testnet");
  return Object.freeze({chainId,txHash:txHash.toLowerCase(),blockHash:(receipt as {blockHash:string}).blockHash,blockNumber:tx.blockNumber,from:tx.from.toLowerCase(),to:tx.to.toLowerCase()});
}

function parseSession(value:unknown):CardSession{
  if(!object(value)||value.productClientId!==CLIENT_ID||value.bundleId!==BUNDLE_ID||typeof value.token!="string"||typeof value.sessionBinding!="string"||typeof value.requestDigest!="string"||typeof value.account!="string"||!Array.isArray(value.scopes)||value.scopes.join("\n")!==SCOPES.join("\n")||typeof value.issuedAt!="string"||typeof value.expiresAt!="string"||typeof value.deviceId!="string"||Date.parse(value.expiresAt)<=Date.now())throw new Error("Central Wallet session binding is invalid");
  return Object.freeze(value as CardSession);
}
function requiredGateway(value:string):string{const raw=value.trim().replace(/\/$/,"");let parsed:URL;try{parsed=new URL(raw)}catch{throw new Error("YNX Card Gateway is not configured")};if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=="/"||parsed.search||parsed.hash)throw new Error("YNX Card Gateway URL is invalid");if(parsed.protocol==="http:"&&!( ["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX Card Gateway requires HTTPS");return raw}
async function json(url:string,input:{method:string;body:unknown}):Promise<unknown>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);try{const response=await fetch(url,{method:input.method,headers:{"Content-Type":"application/json","X-YNX-Client":CLIENT_ID},body:JSON.stringify(input.body),signal:controller.signal});const value=await response.json().catch(()=>({error:"Invalid Gateway response"}));if(!response.ok)throw new Error(object(value)&&typeof value.error==="string"?value.error:`Gateway returned ${response.status}`);return value}finally{clearTimeout(timer)}}
async function productRandom():Promise<Readonly<{secret:Uint8Array;nonce:Uint8Array}>>{const crypto=await import("expo-crypto");return{secret:await crypto.getRandomBytesAsync(32),nonce:await crypto.getRandomBytesAsync(32)}}
function object(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
