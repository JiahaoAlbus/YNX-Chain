import {
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  requestDigest,
  verifyAuthorization,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type ProductBinding,
} from "@ynx-chain/wallet-auth";

export const DEX_WALLET_CALLBACK="https://dex.ynxweb4.com/wallet-auth/callback";
export const DEX_WALLET_CLIENT="ynx-dex-web-v1";
export const DEX_WALLET_BUNDLE="com.ynxweb4.dex.web";
export const DEX_WALLET_SCOPES=["account:read","dex:positions:read","dex:transaction:request"] as const;
const PENDING="ynx-dex-wallet-pending-v1";
const DB="ynx-dex-device-v1",STORE="keys",KEY="p256";

export const DEX_WALLET_REGISTRY:Readonly<Record<string,ProductBinding>>=Object.freeze({
  [DEX_WALLET_CLIENT]:Object.freeze({
    requestingProduct:"dex",
    bundleId:DEX_WALLET_BUNDLE,
    callbacks:Object.freeze([DEX_WALLET_CALLBACK]),
    scopes:Object.freeze([...DEX_WALLET_SCOPES]),
    maxScopes:DEX_WALLET_SCOPES.length,
  }),
});

export class WalletRequestError extends Error{constructor(public code:string,message:string){super(message)}}

export function buildWalletRequest(input:{nonce:string;productDeviceKey:string;now?:Date}):AuthorizationRequest{
  const now=input.now??new Date();
  const request={
    version:"1" as const,
    nonce:input.nonce,
    chainId:"ynx_6423-1" as const,
    requestingProduct:"dex",
    productClientId:DEX_WALLET_CLIENT,
    bundleId:DEX_WALLET_BUNDLE,
    productDeviceAlgorithm:"p256-sha256" as const,
    productDeviceKey:input.productDeviceKey,
    callback:DEX_WALLET_CALLBACK,
    scopes:[...DEX_WALLET_SCOPES],
    purpose:"Connect this account to YNX DEX to read its positions and request separately reviewed Testnet transactions. DEX cannot sign or move assets.",
    issuedAt:now.toISOString(),
    expiresAt:new Date(now.valueOf()+5*60_000).toISOString(),
  };
  try{return parseAuthorizationRequest(request,{now,registry:DEX_WALLET_REGISTRY})}
  catch(reason){throw new WalletRequestError(code(reason),message(reason))}
}

export function walletDeepLink(request:AuthorizationRequest){
  try{return encodeRequestDeepLink(parseAuthorizationRequest(request,{now:new Date(request.issuedAt),registry:DEX_WALLET_REGISTRY}))}
  catch(reason){throw new WalletRequestError(code(reason),message(reason))}
}

export async function beginWalletAuthorization(storage:Storage=sessionStorage,now=new Date()){
  const productDeviceKey=await browserDevicePublicKey();
  const request=buildWalletRequest({nonce:randomNonce(),productDeviceKey,now});
  storage.setItem(PENDING,JSON.stringify(request));
  return {request,url:walletDeepLink(request)};
}

export function consumeWalletCallback(url:string,storage:Storage=sessionStorage,now=new Date()):AuthorizationResponse|null{
  const parsed=new URL(url);
  if(parsed.origin+parsed.pathname!==DEX_WALLET_CALLBACK||!parsed.searchParams.has("response"))return null;
  const raw=storage.getItem(PENDING);
  if(!raw)throw new WalletRequestError("MISSING_PENDING_REQUEST","This Wallet return has no pending DEX request on this browser tab.");
  try{
    const request=parseAuthorizationRequest(JSON.parse(raw),{now:new Date(JSON.parse(raw).issuedAt),registry:DEX_WALLET_REGISTRY});
    const response=parseCallbackURL(url,DEX_WALLET_CALLBACK);
    const verified=verifyAuthorization(response,{...request,requestDigest:requestDigest(request),now});
    storage.removeItem(PENDING);
    return verified;
  }catch(reason){throw new WalletRequestError(code(reason),message(reason))}
}

async function browserDevicePublicKey(){
  if(!globalThis.crypto?.subtle||typeof indexedDB==="undefined")throw new WalletRequestError("DEVICE_CRYPTO_UNAVAILABLE","This browser cannot create a protected DEX device identity.");
  const existing=await readDevice();
  const pair=existing??await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
  if(!existing)await writeDevice(pair);
  const raw=new Uint8Array(await crypto.subtle.exportKey("raw",pair.publicKey));
  if(raw.length!==65||raw[0]!==4)throw new WalletRequestError("INVALID_DEVICE_KEY","Browser returned a non-canonical P-256 public key.");
  const compressed=new Uint8Array(33);compressed[0]=2+(raw[64]&1);compressed.set(raw.slice(1,33),1);
  return bytesBase64url(compressed);
}

function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function readDevice():Promise<CryptoKeyPair|null>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get(KEY);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close()})}
async function writeDevice(pair:CryptoKeyPair){const db=await openDB();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(pair,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()}
function randomNonce(){const value=new Uint8Array(24);crypto.getRandomValues(value);return bytesBase64url(value)}
function bytesBase64url(bytes:Uint8Array){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")}
function code(value:unknown){return value&&typeof value==="object"&&"code" in value?String(value.code):"WALLET_AUTH_FAILED"}
function message(value:unknown){return value instanceof Error?value.message:"Wallet authorization failed."}
