import {
  canonicalJSON,
  createGatewayChallenge,
  createProductDeviceIdentity,
  createProductSessionProof,
  encodeProductSessionProofHeader,
  encodeRequestDeepLink,
	createDexActionDeepLink,
	evmAddressFromYNX,
  httpBodyDigest,
  parseCallbackURL,
  parseCentralWalletSession,
	parseDexActionResponse,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type CentralWalletSession,
	type DexActionRequest,
} from "@ynx-chain/wallet-auth";

export const DEX_WALLET = Object.freeze({
  version: "1" as const,
  chainId: "ynx_6423-1" as const,
  requestingProduct: "dex",
  productClientId: "ynx-dex-web-v1",
  bundleId: "com.ynxweb4.dex.web",
  productDeviceAlgorithm: "p256-sha256" as const,
  callback: "https://dex.ynxweb4.com/wallet-auth/callback",
  scopes: Object.freeze(["account:read", "dex:positions:read", "dex:transaction:request"]),
});

export const WALLET_INSTALL_URL = "https://ynxweb4.com/ecosystem?product=wallet";
const GATEWAY = (import.meta.env.VITE_WALLET_GATEWAY_URL || "/wallet-gateway").replace(/\/$/, "");
const DB_NAME = "ynx-dex-wallet-v1";
const STORE = "auth";
const CHAIN_REST = (import.meta.env.VITE_CHAIN_REST_URL || "https://rest.ynxweb4.com").replace(/\/$/, "");

type ProductDevice = Readonly<{productDeviceKey:string;productDeviceSecret:string}>;
type WalletState = Readonly<{session:CentralWalletSession;device:ProductDevice}>;
let current:WalletState|null = null;

export function buildWalletRequest(device:ProductDevice, now=new Date()):AuthorizationRequest {
  const issuedAt=now.toISOString();
  return Object.freeze({
    ...DEX_WALLET,
    nonce:nonce(),
    productDeviceKey:device.productDeviceKey,
    purpose:"Connect this YNX account to YNX DEX on this device to read positions and request exact transaction reviews. DEX cannot sign or move assets.",
    issuedAt,
    expiresAt:new Date(now.getTime()+300_000).toISOString(),
  });
}

export async function beginWalletAuthorization():Promise<string>{
  const saved=await read<ProductDevice>("device");
  const device=saved??createProductDeviceIdentity();
  const authorizationRequest=buildWalletRequest(device);
  await Promise.all([write("device",device),write("pendingRequest",authorizationRequest)]);
  return encodeRequestDeepLink(authorizationRequest);
}

export async function completeWalletAuthorization(url:string):Promise<CentralWalletSession>{
  const [authorizationRequest,device]=await Promise.all([read<AuthorizationRequest>("pendingRequest"),read<ProductDevice>("device")]);
  if(!authorizationRequest||!device)throw new Error("This Wallet callback is not bound to a pending DEX login on this device.");
  const now=new Date();
  const response=parseCallbackURL(url,DEX_WALLET.callback);
  const walletApproval=verifyAuthorization(response,{...authorizationRequest,requestDigest:requestDigest(authorizationRequest),now});
  const challenge=createGatewayChallenge(walletApproval,{challenge:nonce(),expiresAt:new Date(Math.min(now.getTime()+60_000,Date.parse(walletApproval.expiresAt))).toISOString()},now);
  const gatewayCompletion=signGatewayChallenge(challenge,device.productDeviceSecret);
  const result=await fetch(`${GATEWAY}/v1/wallet/sessions/complete`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},credentials:"omit",body:canonicalJSON({authorizationRequest,walletApproval,gatewayCompletion})});
  const envelope=await result.json().catch(()=>null) as {ok?:boolean;result?:unknown;error?:{message?:string}}|null;
  if(!result.ok||!envelope?.ok||!envelope.result)throw new Error(envelope?.error?.message||`Wallet session completion failed closed (${result.status}).`);
  const session=parseCentralWalletSession(envelope.result);
  if(session.productClientId!==DEX_WALLET.productClientId||session.bundleId!==DEX_WALLET.bundleId||session.productDeviceKey!==device.productDeviceKey)throw new Error("Wallet returned a session for another product or device.");
  current=Object.freeze({session,device});
  await Promise.all([write("session",session),remove("pendingRequest")]);
  return session;
}

export async function restoreWalletSession(now=new Date()):Promise<CentralWalletSession|null>{
  if(typeof indexedDB==="undefined")return null;
  const [input,device]=await Promise.all([read<CentralWalletSession>("session"),read<ProductDevice>("device")]);
  if(!input||!device)return null;
  const session=parseCentralWalletSession(input);
  if(session.expiresAt<=now.toISOString()||session.productDeviceKey!==device.productDeviceKey){await clearWalletSession();return null;}
  current=Object.freeze({session,device});
  return session;
}

export async function positionsProof(now=new Date()):Promise<string>{
  if(!current&&!(await restoreWalletSession(now)))throw new Error("Connect YNX Wallet to read account positions.");
  const state=current!;
  for(const scope of ["account:read","dex:positions:read"])if(!state.session.scopes.includes(scope))throw new Error("Wallet session does not grant DEX position access.");
  if(state.session.expiresAt<=now.toISOString()){await clearWalletSession();throw new Error("Wallet session expired. Connect again.");}
  const body=canonicalJSON({requiredScopes:["account:read","dex:positions:read"]});
  const proof=createProductSessionProof(state.session,{method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest:httpBodyDigest(body),nonce:nonce(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(now.getTime()+30_000,Date.parse(state.session.expiresAt))).toISOString()},state.device.productDeviceSecret);
  return encodeProductSessionProofHeader(proof);
}

export async function beginExactInputSwap(input:{poolId:string;assetIn:string;amountIn:number;minAmountOut:number;expectedAmount:number;reserve0:number;reserve1:number;poolBlockHeight:number;poolUpdatedAt:string;asset0:string;asset1:string;feeBps:number},now=new Date()):Promise<string>{
  if(!current&&!(await restoreWalletSession(now)))throw new Error("Connect YNX Wallet before requesting a transaction review.");
  const state=current!;
  if(!state.session.scopes.includes("dex:transaction:request"))throw new Error("Wallet session does not grant DEX transaction requests.");
  const accountWire=evmAddressFromYNX(state.session.account);
  const [accountResponse,poolResponse]=await Promise.all([
    fetch(`${CHAIN_REST}/accounts/${accountWire}`,{headers:{Accept:"application/json"},credentials:"omit"}),
    fetch(`${CHAIN_REST}/dex/pools/${encodeURIComponent(input.poolId)}`,{headers:{Accept:"application/json"},credentials:"omit"}),
  ]);
  if(!accountResponse.ok||!poolResponse.ok)throw new Error("Authoritative account or pool state is unavailable.");
  const accountEnvelope=await accountResponse.json() as {account?:{nonce?:number}};
  const pool=await poolResponse.json() as {id?:string;asset0?:string;asset1?:string;reserve0?:number;reserve1?:number;feeBps?:number;blockHeight?:number;updatedAt?:string};
  if(pool.id!==input.poolId||pool.asset0!==input.asset0||pool.asset1!==input.asset1||pool.reserve0!==input.reserve0||pool.reserve1!==input.reserve1||pool.feeBps!==input.feeBps||pool.blockHeight!==input.poolBlockHeight||pool.updatedAt!==input.poolUpdatedAt)throw new Error("Pool changed after quote. Refresh before Wallet review.");
  const nonceValue=accountEnvelope.account?.nonce;
  if(typeof nonceValue!=="number"||!Number.isSafeInteger(nonceValue)||nonceValue<0)throw new Error("Authoritative account nonce is invalid.");
  const issuedAt=now.toISOString(),deadlineUnix=Math.floor(now.getTime()/1000)+300;
  const request:DexActionRequest={version:"1",chainId:6423,productClientId:"ynx-dex-web-v1",bundleId:"com.ynxweb4.dex.web",callback:"https://dex.ynxweb4.com/wallet-action/callback",sessionBinding:state.session.sessionBinding,account:state.session.account,nonce:nonceValue+1,action:"dex_swap_exact_input",payload:{poolId:input.poolId,assetIn:input.assetIn,amountIn:input.amountIn,minAmountOut:input.minAmountOut,deadlineUnix},quote:{poolId:input.poolId,poolBlockHeight:input.poolBlockHeight,poolUpdatedAt:input.poolUpdatedAt,asset0:input.asset0,asset1:input.asset1,reserve0:input.reserve0,reserve1:input.reserve1,feeBps:input.feeBps,expectedAmount:input.expectedAmount},issuedAt,expiresAt:new Date(now.getTime()+300_000).toISOString()};
  await write("pendingDexAction",request);
  return createDexActionDeepLink(request,now);
}

export async function completeDexAction(url:string,now=new Date()):Promise<string>{
  const request=await read<DexActionRequest>("pendingDexAction");
  if(!request)throw new Error("This Wallet callback is not bound to a pending DEX action.");
  const encoded=new URL(url).searchParams.get("response");
  if(!encoded)throw new Error("Wallet action response is missing.");
  let raw:unknown;
  try{raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(encoded.length/4)*4,"=")),character=>character.charCodeAt(0))))}catch{throw new Error("Wallet action response encoding is invalid.")}
  const verified=parseDexActionResponse(raw,request,now);
  const route=`/dex/pools/${encodeURIComponent(String(request.payload.poolId))}/swaps/exact-input`;
  const response=await fetch(`${CHAIN_REST}${route}`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},credentials:"omit",body:JSON.stringify(verified.signedTransaction)});
  if(!response.ok)throw new Error(`Authoritative DEX broadcast failed (${response.status}).`);
  const result=await response.json() as {transaction?:{hash?:string}};
  if(result.transaction?.hash!==verified.transactionHash)throw new Error("Authoritative DEX response hash does not match the Wallet-signed transaction.");
  await remove("pendingDexAction");
  return verified.transactionHash;
}

export function dexActionCallbackPending(url=location.href){const parsed=new URL(url);return parsed.pathname==="/wallet-action/callback"&&parsed.searchParams.has("response")}

export async function clearWalletSession(){current=null;await remove("session")}
export function callbackPending(url=location.href){const parsed=new URL(url);return parsed.pathname===new URL(DEX_WALLET.callback).pathname&&parsed.searchParams.has("response")}
export function shortAccount(account:string){return `${account.slice(0,10)}…${account.slice(-6)}`}
function nonce(){let binary="";for(const byte of crypto.getRandomValues(new Uint8Array(24)))binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")}

function database():Promise<IDBDatabase>{if(typeof indexedDB==="undefined")return Promise.reject(new Error("Secure browser storage is unavailable. Use a supported browser or install YNX Wallet."));return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await database();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
function read<T>(key:string){return transaction<T|undefined>("readonly",store=>store.get(key))}
function write(key:string,value:unknown){return transaction<IDBValidKey>("readwrite",store=>store.put(value,key))}
function remove(key:string){return transaction<undefined>("readwrite",store=>store.delete(key))}
