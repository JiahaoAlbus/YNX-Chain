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
type PoolSnapshotInput = Readonly<{poolId:string;reserve0:number;reserve1:number;poolBlockHeight:number;poolUpdatedAt:string;asset0:string;asset1:string;feeBps:number}>;
type AuthoritativePool = Readonly<{id:string;asset0:string;asset1:string;reserve0:number;reserve1:number;feeBps:number;totalShares:number;blockHeight:number;updatedAt:string}>;
type ActionContext = Awaited<ReturnType<typeof authoritativeActionContext>>;
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

async function authoritativeActionContext(input:PoolSnapshotInput,now:Date){
  if(!current&&!(await restoreWalletSession(now)))throw new Error("Connect YNX Wallet before requesting a transaction review.");
  const state=current!;
  if(!state.session.scopes.includes("dex:transaction:request"))throw new Error("Wallet session does not grant DEX transaction requests.");
  const accountWire=evmAddressFromYNX(state.session.account);
  const [accountResponse,poolResponse]=await Promise.all([
    fetch(`${CHAIN_REST}/accounts/${accountWire}`,{headers:{Accept:"application/json"},credentials:"omit"}),
    fetch(`${CHAIN_REST}/dex/pools/${encodeURIComponent(input.poolId)}`,{headers:{Accept:"application/json"},credentials:"omit"}),
  ]);
  if(!accountResponse.ok||!poolResponse.ok)throw new Error("Authoritative account or pool state is unavailable.");
  const account=await accountResponse.json() as {nonce?:number};
  const poolEnvelope=await poolResponse.json() as {failure?:boolean;pool?:AuthoritativePool};
  const pool=poolEnvelope.pool;
  if(poolEnvelope.failure||!pool)throw new Error("Authoritative pool envelope is invalid.");
  if(pool.id!==input.poolId||pool.asset0!==input.asset0||pool.asset1!==input.asset1||pool.reserve0!==input.reserve0||pool.reserve1!==input.reserve1||pool.feeBps!==input.feeBps||pool.blockHeight!==input.poolBlockHeight||pool.updatedAt!==input.poolUpdatedAt)throw new Error("Pool changed after quote. Refresh before Wallet review.");
  if(!Number.isSafeInteger(pool.totalShares)||pool.totalShares<0)throw new Error("Authoritative pool share supply is invalid.");
  const nonceValue=account.nonce;
  if(typeof nonceValue!=="number"||!Number.isSafeInteger(nonceValue)||nonceValue<0)throw new Error("Authoritative account nonce is invalid.");
  return {state,pool,nonce:nonceValue+1};
}

async function beginPoolAction(input:PoolSnapshotInput,action:DexActionRequest["action"],payload:Record<string,string|number>,expectedAmount:number,now:Date,knownContext?:ActionContext){
  const {state,nonce}=knownContext??await authoritativeActionContext(input,now);
  const issuedAt=now.toISOString(),deadlineUnix=Math.floor(now.getTime()/1000)+300;
  const request:DexActionRequest={version:"1",chainId:6423,productClientId:"ynx-dex-web-v1",bundleId:"com.ynxweb4.dex.web",callback:"https://dex.ynxweb4.com/wallet-action/callback",sessionBinding:state.session.sessionBinding,account:state.session.account,nonce,action,payload:{...payload,poolId:input.poolId,deadlineUnix},quote:{poolId:input.poolId,poolBlockHeight:input.poolBlockHeight,poolUpdatedAt:input.poolUpdatedAt,asset0:input.asset0,asset1:input.asset1,reserve0:input.reserve0,reserve1:input.reserve1,feeBps:input.feeBps,expectedAmount},issuedAt,expiresAt:new Date(now.getTime()+300_000).toISOString()};
  await write("pendingDexAction",request);
  return createDexActionDeepLink(request,now);
}

export async function beginExactInputSwap(input:PoolSnapshotInput&{assetIn:string;amountIn:number;minAmountOut:number;expectedAmount:number},now=new Date()):Promise<string>{
  return beginPoolAction(input,"dex_swap_exact_input",{assetIn:input.assetIn,amountIn:input.amountIn,minAmountOut:input.minAmountOut},input.expectedAmount,now);
}

export async function beginLiquidityAdd(input:PoolSnapshotInput&{amount0:number;amount1:number},now=new Date()):Promise<string>{
  const context=await authoritativeActionContext(input,now),{pool}=context;
  const expected=liquidityShares(BigInt(input.amount0),BigInt(input.amount1),pool);
  const minShares=minimumBps(expected,50);
  return beginPoolAction(input,"dex_liquidity_add",{amount0:input.amount0,amount1:input.amount1,minShares:toSafeNumber(minShares,"minimum LP shares")},toSafeNumber(expected,"expected LP shares"),now,context);
}

export async function beginLiquidityRemove(input:PoolSnapshotInput&{shares:number},now=new Date()):Promise<string>{
  const context=await authoritativeActionContext(input,now),{pool}=context;
  const [amount0,amount1]=liquidityAmounts(BigInt(input.shares),pool);
  const minAmount0=minimumBps(amount0,50),minAmount1=minimumBps(amount1,50);
  return beginPoolAction(input,"dex_liquidity_remove",{shares:input.shares,minAmount0:toSafeNumber(minAmount0,"minimum token 0"),minAmount1:toSafeNumber(minAmount1,"minimum token 1")},toSafeNumber(amount0+amount1,"expected withdrawal total"),now,context);
}

function liquidityShares(amount0:bigint,amount1:bigint,pool:AuthoritativePool){
  if(amount0<=0n||amount1<=0n)throw new Error("Both liquidity amounts must be positive.");
  const reserve0=BigInt(pool.reserve0),reserve1=BigInt(pool.reserve1),totalShares=BigInt(pool.totalShares);
  if(reserve0<=0n||reserve1<=0n||totalShares<=0n)throw new Error("Initial pool funding requires the governed pool bootstrap flow.");
  if(amount0*reserve1!==amount1*reserve0)throw new Error("Liquidity must match the current reserve ratio exactly.");
  const shares=amount0*totalShares/reserve0;
  if(shares<=0n)throw new Error("Liquidity amount is too small to mint a share.");
  return shares;
}

function liquidityAmounts(shares:bigint,pool:AuthoritativePool):readonly[bigint,bigint]{
  const reserve0=BigInt(pool.reserve0),reserve1=BigInt(pool.reserve1),totalShares=BigInt(pool.totalShares);
  if(shares<=0n||totalShares<=0n||shares>totalShares)throw new Error("LP share amount is invalid for this pool.");
  const amount0=shares*reserve0/totalShares,amount1=shares*reserve1/totalShares;
  if(amount0<=0n||amount1<=0n)throw new Error("LP share amount is too small to withdraw both assets.");
  return [amount0,amount1];
}
function minimumBps(value:bigint,slippageBps:number){return value*BigInt(10_000-slippageBps)/10_000n}
function toSafeNumber(value:bigint,label:string){if(value<=0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`${label} exceeds the Wallet integer safety bound.`);return Number(value)}

export async function completeDexAction(url:string,now=new Date()):Promise<string>{
  const request=await read<DexActionRequest>("pendingDexAction");
  if(!request)throw new Error("This Wallet callback is not bound to a pending DEX action.");
  const encoded=new URL(url).searchParams.get("response");
  if(!encoded)throw new Error("Wallet action response is missing.");
  let raw:unknown;
  try{raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(encoded.length/4)*4,"=")),character=>character.charCodeAt(0))))}catch{throw new Error("Wallet action response encoding is invalid.")}
  const verified=parseDexActionResponse(raw,request,now);
  const suffix:Record<DexActionRequest["action"],string>={dex_swap_exact_input:"swaps/exact-input",dex_swap_exact_output:"swaps/exact-output",dex_liquidity_add:"liquidity/add",dex_liquidity_remove:"liquidity/remove"};
  const route=`/dex/pools/${encodeURIComponent(String(request.payload.poolId))}/${suffix[request.action]}`;
  const response=await fetch(`${CHAIN_REST}${route}`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},credentials:"omit",body:JSON.stringify(verified.signedTransaction)});
  if(!response.ok)throw new Error(`Authoritative DEX broadcast failed (${response.status}).`);
  const result=await response.json() as {failure?:boolean;event?:{txHash?:string;type?:string}};
  if(result.failure||result.event?.txHash!==verified.transactionHash||result.event?.type!==request.action)throw new Error("Authoritative DEX event does not match the Wallet-signed transaction.");
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
