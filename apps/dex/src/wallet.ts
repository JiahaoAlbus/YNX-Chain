import {
  canonicalJSON,
  createGatewayChallenge,
  createProductDeviceIdentity,
  createProductSessionProof,
  encodeProductSessionProofHeader,
  encodeRequestDeepLink,
  httpBodyDigest,
  parseCallbackURL,
  parseCentralWalletSession,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type CentralWalletSession,
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

export async function clearWalletSession(){current=null;await remove("session")}
export function callbackPending(url=location.href){const parsed=new URL(url);return parsed.pathname===new URL(DEX_WALLET.callback).pathname&&parsed.searchParams.has("response")}
export function shortAccount(account:string){return `${account.slice(0,10)}…${account.slice(-6)}`}
function nonce(){let binary="";for(const byte of crypto.getRandomValues(new Uint8Array(24)))binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")}

function database():Promise<IDBDatabase>{if(typeof indexedDB==="undefined")return Promise.reject(new Error("Secure browser storage is unavailable. Use a supported browser or install YNX Wallet."));return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await database();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
function read<T>(key:string){return transaction<T|undefined>("readonly",store=>store.get(key))}
function write(key:string,value:unknown){return transaction<IDBValidKey>("readwrite",store=>store.put(value,key))}
function remove(key:string){return transaction<undefined>("readwrite",store=>store.delete(key))}
