import { p256 } from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth";
import {StandardWalletConnection,enhanceWithProductSession} from "@ynx/dapp-connect-sdk";
import {walletErrorResponse} from "@ynx-chain/wallet-auth";
import {acceptedCardGatewayEndpoint} from "./publicEndpointManifest";
import {
  encodeRequestDeepLink,
  parseAuthorizationCallbackURL,
  parseAuthorizationRequest,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type GatewayChallenge,
} from "@ynx-chain/wallet-auth";

type WalletRequest = {method:string;params?:readonly unknown[]};
type WalletRequestResult = {error?:{code?:number;message?:string}};

type ProviderListener=(...args:readonly unknown[])=>void;
type EIP1193Provider = Readonly<{request:(args:WalletRequest)=>Promise<unknown>;isMetaMask?:unknown;isYNXWallet?:unknown;providers?:readonly unknown[];on?:(event:string,listener:ProviderListener)=>void;removeListener?:(event:string,listener:ProviderListener)=>void}>;
export type Eip1193Provider=EIP1193Provider;
type ProviderAnnouncement=Readonly<{info?:Readonly<{rdns?:unknown}>;provider?:unknown}>;
type DiscoveryTarget=Readonly<{ethereum?:unknown;addEventListener?:(event:string,listener:(event:unknown)=>void)=>void;removeEventListener?:(event:string,listener:(event:unknown)=>void)=>void;dispatchEvent?:(event:unknown)=>void;CustomEvent?:new(type:string,init?:Readonly<{detail?:unknown}>)=>unknown}>;
export type WalletProviderKind="metamask"|"ynx-wallet";
export type WalletProviderEvents=Readonly<{accountsChanged:(accounts:readonly string[])=>void;chainChanged:(chainId:string)=>void;disconnect:()=>void}>;

const encodeBase64url=(WalletAuth as unknown as {encodeBase64url:(value:Uint8Array)=>string}).encodeBase64url;

export const PRODUCT_ID="ynx-card";
export const CLIENT_ID="ynx-card-v1";
export const BUNDLE_ID="com.ynxweb4.card";
export const CALLBACK="ynxcard://wallet-auth/callback";
export const SCOPES=Object.freeze(["account:read","card:application:write","card:controls:write","card:dispute:write"] as const);
export const YNX_TESTNET_CHAIN_DECIMAL=6423;
export const YNX_TESTNET_CHAIN_ID="0x1917";
export const YNX_TESTNET_CHAIN_NAME="YNX Testnet";

export type PendingAuthorization=Readonly<{request:AuthorizationRequest;deviceSecret:string}>;
export type PendingAuthorizationRequest=Readonly<{request:AuthorizationRequest}>;
export type CardSession=Readonly<{token:string;sessionBinding:string;requestDigest:string;account:string;productClientId:"ynx-card-v1";bundleId:"com.ynxweb4.card";scopes:readonly string[];issuedAt:string;expiresAt:string;deviceId:string}>;
export type Eip1193WalletSession=Readonly<{address:string;chainId:string;connectedAt:string;provider:"eip1193"}>;
export type CardWalletError=Readonly<{code:string;retryable:boolean;safeMessage:string;monitoringClass:string;userAction:string;requestId?:string;traceId?:string;errorId?:string}>;
export type ProductSessionRuntime=Readonly<{state:"PRODUCT_SESSION_READY";session:CardSession}>|Readonly<{state:"PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY";sessionBinding:string;expiresAt:string}>|Readonly<{state:"PRIVATE_SERVICE_DEGRADED"}&CardWalletError>;
export type TestnetTopupIntent=Readonly<{id:string;chainId:string;recipient:string;amountWei:string;minConfirmations:number;expiresAt:string}>;
export type TopupEvidence=Readonly<{chainId:string;txHash:string;blockNumber:string;blockHash:string;from:string;to:string;valueWei:string;confirmations:number}>;

const ynxChainParameters={chainId:YNX_TESTNET_CHAIN_ID,chainName:YNX_TESTNET_CHAIN_NAME,nativeCurrency:{name:"YNX",symbol:"YNXT",decimals:18},rpcUrls:["https://rpc.ynxweb4.com/evm"],blockExplorerUrls:[]};
export const METAMASK_INSTALL_URL="https://metamask.io/download/";
export const METAMASK_CARD_DEEP_LINK="https://metamask.app.link/dapp/card.ynxweb4.com";

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

export function walletDeepLink(pending:PendingAuthorizationRequest):string{return encodeRequestDeepLink(pending.request)}
export function parseWalletAuthorizationCallback(callbackURL:string,pending:PendingAuthorizationRequest,now=new Date()):ReturnType<typeof parseAuthorizationCallbackURL>{return parseAuthorizationCallbackURL(callbackURL,pending.request,now)}

// Legacy private route retained only for compatibility evidence. Card runtime
// now uses createProductWalletConnection and the canonical /v2 routes.
export async function completeLegacyCentralSession(pending:PendingAuthorization,approval:AuthorizationResponse):Promise<CardSession>{
  const base=acceptedCardGatewayEndpoint();
  const challenge=await json(`${base}/app/card/session/challenges`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval}}) as {challenge:GatewayChallenge};
  const completion=signGatewayChallenge(challenge.challenge,pending.deviceSecret);
  const value=await json(`${base}/app/card/session/complete`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval,gatewayCompletion:completion}});
  return parseSession(value);
}

export async function enhanceCardProductSession(standard:Eip1193WalletSession,complete:()=>Promise<CardSession>):Promise<ProductSessionRuntime>{
  const outcome=await enhanceWithProductSession({standardConnection:{account:standard.address},complete});
  if(outcome.state==="PRODUCT_SESSION_READY")return Object.freeze({state:"PRODUCT_SESSION_READY",session:outcome.session as CardSession});
  return Object.freeze({state:"PRIVATE_SERVICE_DEGRADED",...classifyCardWalletError({code:outcome.code??"PRODUCT_SESSION_GATEWAY_UNREACHABLE",requestId:outcome.requestId,traceId:outcome.traceId,errorId:outcome.errorId})});
}

const ERROR_ALIASES:Readonly<Record<string,string>>=Object.freeze({WALLET_USER_REJECTED:"USER_REJECTED",WALLET_UNAUTHORIZED:"UNAUTHORIZED",WALLET_UNSUPPORTED_METHOD:"UNSUPPORTED_METHOD",WALLET_DISCONNECTED:"PROVIDER_DISCONNECTED",WALLET_CHAIN_DISCONNECTED:"CHAIN_DISCONNECTED",WRONG_CHAIN:"UNKNOWN_CHAIN",ACCOUNT_REQUIRED:"UNAUTHORIZED",PRODUCT_SESSION_GATEWAY_UNREACHABLE:"GATEWAY_UNAVAILABLE",PRODUCT_SESSION_DEVICE_PROOF_REJECTED:"INVALID_DEVICE_PROOF",PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW:"PRODUCT_SESSION_EXPIRED",CALLBACK_PENDING_MISSING:"CALLBACK_MISMATCH",CALLBACK_MISMATCH:"CALLBACK_MISMATCH",CALLBACK_REPLAY:"REPLAY",CALLBACK_EXPIRED:"PRODUCT_SESSION_EXPIRED"});

export function classifyCardWalletError(input:unknown):CardWalletError{
  const source=object(input)?input:{};
  const raw=typeof input==="number"||typeof input==="string"?input:source.code;
  const code=typeof raw==="string"?ERROR_ALIASES[raw]??raw:raw;
  if([source.requestId,source.traceId,source.errorId].some(value=>value!==undefined&&typeof value!=="string"))return unknownWalletError();
  const correlation={requestId:source.requestId as string|undefined,traceId:source.traceId as string|undefined,errorId:source.errorId as string|undefined};
  try{const response=walletErrorResponse(code,correlation),body=response.body;return Object.freeze({code:body.code,retryable:body.retryable,safeMessage:body.safeMessage,monitoringClass:body.monitoringClass,userAction:body.userAction,requestId:body.requestId,traceId:body.traceId,errorId:body.errorId});}
  catch{return unknownWalletError();}
}
function unknownWalletError():CardWalletError{return Object.freeze({code:"UNKNOWN_WALLET_ERROR",retryable:false,safeMessage:"Wallet error could not be verified.",monitoringClass:"wallet-contract",userAction:"return-to-product"});}

export function verifiedApproval(callbackURL:string,pending:PendingAuthorization,now=new Date()):AuthorizationResponse{
  const result=parseWalletAuthorizationCallback(callbackURL,pending,now);
  if("decision" in result&&result.decision==="rejected")throw new Error("Wallet authorization was rejected");
  return result as AuthorizationResponse;
}

export function resolveEip1193Provider():Eip1193Provider|null{
  const globalWallet=(globalThis as {ethereum?:unknown}).ethereum;
  if(object(globalWallet)&&typeof (globalWallet as {request?:unknown}).request==="function"){
    return globalWallet as Eip1193Provider;
  }
  return null;
}

function strictMetaMaskProvider(value:unknown):value is Eip1193Provider{return object(value)&&typeof value.request==="function"&&value.isMetaMask===true}
function strictYNXProvider(value:unknown):value is Eip1193Provider{return object(value)&&typeof value.request==="function"&&value.isYNXWallet===true}
export function isExpectedWalletProvider(value:unknown,kind:WalletProviderKind):value is Eip1193Provider{return kind==="metamask"?strictMetaMaskProvider(value):strictYNXProvider(value)}
function uniqueMetaMask(candidates:readonly unknown[]):Eip1193Provider|null{const values=candidates.filter(strictMetaMaskProvider);return values.length===1?values[0]??null:null}
function uniqueYNX(candidates:readonly unknown[]):Eip1193Provider|null{const values=candidates.filter(strictYNXProvider);return values.length===1?values[0]??null:null}
function announcedMetaMask(event:unknown):Eip1193Provider|null{const detail=object(event)?event.detail:undefined;if(!object(detail))return null;const announcement=detail as ProviderAnnouncement;return announcement.info?.rdns==="io.metamask"&&strictMetaMaskProvider(announcement.provider)?announcement.provider:null}
function announcedYNX(event:unknown):Eip1193Provider|null{const detail=object(event)?event.detail:undefined;if(!object(detail))return null;const announcement=detail as ProviderAnnouncement;return ["com.ynx.wallet","com.ynxwallet","io.ynx.wallet"].includes(String(announcement.info?.rdns))&&object(announcement.provider)&&typeof announcement.provider.request==="function"?announcement.provider as Eip1193Provider:null}
function requestProviderEvent(target:DiscoveryTarget):unknown{const Constructor=target.CustomEvent??(globalThis as {CustomEvent?:DiscoveryTarget["CustomEvent"]}).CustomEvent;return Constructor?new Constructor("eip6963:requestProvider"):Object.freeze({type:"eip6963:requestProvider"})}

export async function resolveMetaMaskEip1193Provider(target:DiscoveryTarget=globalThis as DiscoveryTarget,waitMs=160):Promise<Eip1193Provider|null>{
  const announcements:Eip1193Provider[]=[];
  const onAnnouncement=(event:unknown)=>{const provider=announcedMetaMask(event);if(provider&&!announcements.includes(provider))announcements.push(provider);};
  target.addEventListener?.("eip6963:announceProvider",onAnnouncement);
  try{target.dispatchEvent?.(requestProviderEvent(target));if(waitMs>0)await new Promise<void>(resolve=>setTimeout(resolve,waitMs));}
  finally{target.removeEventListener?.("eip6963:announceProvider",onAnnouncement);}
  const announced=uniqueMetaMask(announcements);
  if(announced)return announced;
  const ethereum=target.ethereum;
  if(!object(ethereum))return null;
  return uniqueMetaMask(Array.isArray(ethereum.providers)?ethereum.providers:[ethereum]);
}

export async function resolveYNXEip1193Provider(target:DiscoveryTarget=globalThis as DiscoveryTarget,waitMs=160):Promise<Eip1193Provider|null>{
  const announcements:Eip1193Provider[]=[];
  const onAnnouncement=(event:unknown)=>{const provider=announcedYNX(event);if(provider&&!announcements.includes(provider))announcements.push(provider);};
  target.addEventListener?.("eip6963:announceProvider",onAnnouncement);
  try{target.dispatchEvent?.(requestProviderEvent(target));if(waitMs>0)await new Promise<void>(resolve=>setTimeout(resolve,waitMs));}
  finally{target.removeEventListener?.("eip6963:announceProvider",onAnnouncement);}
  const announced=announcements.length===1?announcements[0]??null:null;
  if(announced)return announced;
  const ethereum=target.ethereum;
  return object(ethereum)?uniqueYNX(Array.isArray(ethereum.providers)?ethereum.providers:[ethereum]):null;
}

async function ensureMetaMaskYNXTestnet(provider:Eip1193Provider):Promise<void>{
  const current=String(await provider.request({method:"eth_chainId",params:[]})??"").toLowerCase();
  if(current===YNX_TESTNET_CHAIN_ID)return;
  try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_TESTNET_CHAIN_ID}]});}
  catch(error){
    if((object(error)?error.code:undefined)!==4902)throw error;
    await provider.request({method:"wallet_addEthereumChain",params:[ynxChainParameters]});
    await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:YNX_TESTNET_CHAIN_ID}]});
  }
  const switched=String(await provider.request({method:"eth_chainId",params:[]})??"").toLowerCase();
  if(switched!==YNX_TESTNET_CHAIN_ID)throw new Error("MetaMask is not connected to YNX Testnet");
}
function connectedMetaMaskAccount(value:unknown):string{if(!Array.isArray(value)||!address(value[0]))throw new Error("MetaMask did not provide an account");return value[0].toLowerCase()}

export async function connectMetaMaskWallet(now=new Date(),provider?:Eip1193Provider|null):Promise<Eip1193WalletSession>{
  const selected=provider??await resolveMetaMaskEip1193Provider();
  if(!strictMetaMaskProvider(selected))throw new Error("MetaMask is not installed or could not be uniquely identified");
  const account=connectedMetaMaskAccount(await selected.request({method:"eth_requestAccounts",params:[]}));
  await ensureMetaMaskYNXTestnet(selected);
  return Object.freeze({address:account,chainId:YNX_TESTNET_CHAIN_ID,connectedAt:now.toISOString(),provider:"eip1193"});
}

export async function restoreMetaMaskWallet(now=new Date(),provider?:Eip1193Provider|null):Promise<Eip1193WalletSession|null>{
  const selected=provider??await resolveMetaMaskEip1193Provider();
  if(!strictMetaMaskProvider(selected))return null;
  const accounts=await selected.request({method:"eth_accounts",params:[]});
  if(!Array.isArray(accounts)||!address(accounts[0]))return null;
  const chainId=String(await selected.request({method:"eth_chainId",params:[]})??"").toLowerCase();
  return chainId===YNX_TESTNET_CHAIN_ID?Object.freeze({address:accounts[0].toLowerCase(),chainId,connectedAt:now.toISOString(),provider:"eip1193"}):null;
}

export async function restoreEip1193Wallet(provider:Eip1193Provider|null,kind:WalletProviderKind,now=new Date()):Promise<Eip1193WalletSession|null>{
  if(!isExpectedWalletProvider(provider,kind))return null;
  const accounts=await provider.request({method:"eth_accounts",params:[]});
  if(!Array.isArray(accounts)||!address(accounts[0]))return null;
  const chainId=String(await provider.request({method:"eth_chainId",params:[]})??"").toLowerCase();
  return chainId===YNX_TESTNET_CHAIN_ID?Object.freeze({address:accounts[0].toLowerCase(),chainId,connectedAt:now.toISOString(),provider:"eip1193"}):null;
}

export function watchEip1193Provider(provider:Eip1193Provider|null,kind:WalletProviderKind,events:WalletProviderEvents):()=>void{
  if(!isExpectedWalletProvider(provider,kind)||typeof provider.on!=="function")return()=>{};
  const accounts=(value:unknown)=>events.accountsChanged(Array.isArray(value)?value.filter(address).map(value=>value.toLowerCase()):[]);
  const chain=(value:unknown)=>events.chainChanged(typeof value==="string"?value.toLowerCase():"");
  const disconnect=()=>events.disconnect();
  provider.on("accountsChanged",accounts);provider.on("chainChanged",chain);provider.on("disconnect",disconnect);
  return()=>{provider.removeListener?.("accountsChanged",accounts);provider.removeListener?.("chainChanged",chain);provider.removeListener?.("disconnect",disconnect);};
}

export function watchMetaMaskProvider(provider:Eip1193Provider|null,events:WalletProviderEvents):()=>void{return watchEip1193Provider(provider,"metamask",events)}

export async function disconnectEip1193Wallet(provider:Eip1193Provider|null,kind:WalletProviderKind):Promise<"revoked"|"local-only">{
  if(!isExpectedWalletProvider(provider,kind))throw new Error("Selected wallet provider is no longer available");
  try{
    await provider.request({method:"wallet_revokePermissions",params:[{eth_accounts:{}}]});
    const accounts=await provider.request({method:"eth_accounts",params:[]});
    if(!Array.isArray(accounts))throw new Error("Wallet did not return an account list after permission revocation");
    return accounts.some(address)?"local-only":"revoked";
  }
  catch(error){const code=object(error)?error.code:undefined;if(code===4200||code===-32601)return "local-only";throw error;}
}

export async function switchEip1193WalletAccount(provider:Eip1193Provider|null,kind:WalletProviderKind):Promise<readonly string[]>{
  if(!isExpectedWalletProvider(provider,kind))throw new Error("Selected wallet provider is no longer available");
  await provider.request({method:"wallet_requestPermissions",params:[{eth_accounts:{}}]});
  const accounts=await provider.request({method:"eth_requestAccounts",params:[]});
  if(!Array.isArray(accounts)||!address(accounts[0]))throw new Error("Wallet did not provide an approved account");
  return Object.freeze(accounts.filter(address).map(value=>value.toLowerCase()));
}

export async function connectEip1193Wallet(provider:Eip1193Provider|null=resolveEip1193Provider(),now=new Date()):Promise<Eip1193WalletSession>{
  if(!provider) throw new Error("EIP-1193 wallet provider is not available");
  const connection=new StandardWalletConnection(provider);
  const standard=await connection.connect();
  await connection.ensureYNXTestnet({addChain:ynxChainParameters});
  const chainId=String(await provider.request({method:"eth_chainId",params:[]})??"").toLowerCase();
  if(chainId!==YNX_TESTNET_CHAIN_ID)throw new Error("Wallet is not connected to YNX Testnet");
  return Object.freeze({address:standard.account.toLowerCase(),chainId,connectedAt:now.toISOString(),provider:"eip1193"});
}

export function parseYnxtAmountToWei(value:string):string{
  const match=/^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(value.trim());
  if(!match)throw new Error("YNXT amount must use up to 18 decimal places");
  const wei=BigInt(match[1]!+((match[2]??"").padEnd(18,"0")));
  if(wei<=0n)throw new Error("YNXT amount must be greater than zero");
  return wei.toString();
}

export async function approveTestnetTopup(provider:Eip1193Provider,wallet:Eip1193WalletSession,intent:TestnetTopupIntent):Promise<string>{
  const expected=validatedTopupIntent(intent);
  if(wallet.chainId!==YNX_TESTNET_CHAIN_ID)throw new Error("Wallet is not connected to YNX Testnet");
  const chainId=String(await provider.request({method:"eth_chainId",params:[]})??"");
  if(chainId!==YNX_TESTNET_CHAIN_ID)throw new Error("Wallet is not connected to YNX Testnet");
  const txHash=await provider.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:expected.recipient,value:toRpcQuantity(expected.amountWei),chainId:YNX_TESTNET_CHAIN_ID}]});
  if(typeof txHash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(txHash))throw new Error("Wallet did not return a Testnet transaction hash");
  return txHash.toLowerCase();
}

export async function loadTestnetTopupEvidence(provider:Eip1193Provider,txHash:string,input:TestnetTopupIntent&Readonly<{sender:string}>):Promise<TopupEvidence>{
  if(!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Top-up transaction hash must be 0x-prefixed");
  const expected=validatedTopupIntent(input);
  if(!address(input.sender))throw new Error("Top-up wallet account is invalid");
  const tx=await provider.request({method:"eth_getTransactionByHash",params:[txHash]});
  const receipt=await provider.request({method:"eth_getTransactionReceipt",params:[txHash]});
  if(!object(tx)||!object(receipt)||typeof (receipt as {blockHash?:unknown}).blockHash!=="string"||typeof (receipt as {blockNumber?:unknown}).blockNumber!=="string"||typeof (receipt as {status?:unknown}).status!=="string"||typeof tx.from!=="string"||typeof tx.to!=="string"||typeof tx.value!=="string"||typeof tx.blockNumber!=="string") throw new Error("Could not read chain evidence");
  const chainId=String((await provider.request({method:"eth_chainId",params:[]})??""));
  if(chainId!==YNX_TESTNET_CHAIN_ID) throw new Error("Top-up transaction is not on YNX Testnet");
  const receiptValue=receipt as {blockHash:string;blockNumber:string;status:string;transactionHash?:unknown};
  if(parseRpcQuantity(receiptValue.status)!==1n)throw new Error("Top-up transaction failed on YNX Testnet");
  if(typeof receiptValue.transactionHash==="string"&&receiptValue.transactionHash.toLowerCase()!==txHash.toLowerCase())throw new Error("Top-up receipt hash does not match transaction");
  if(!sameAddress(tx.from,input.sender))throw new Error("Top-up sender does not match connected wallet");
  if(!sameAddress(tx.to,expected.recipient))throw new Error("Top-up recipient does not match Card funding intent");
  if(parseRpcQuantity(tx.value)!==BigInt(expected.amountWei))throw new Error("Top-up amount does not match Card funding intent");
  if(tx.blockNumber!==receiptValue.blockNumber)throw new Error("Top-up transaction and receipt block do not match");
  const head=await provider.request({method:"eth_blockNumber",params:[]});
  const confirmations=confirmationCount(String(head??""),tx.blockNumber);
  if(confirmations<expected.minConfirmations)throw new Error(`Top-up requires ${expected.minConfirmations} confirmation(s)`);
  return Object.freeze({chainId,txHash:txHash.toLowerCase(),blockHash:receiptValue.blockHash,blockNumber:tx.blockNumber,from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),valueWei:expected.amountWei,confirmations});
}

function validatedTopupIntent(value:TestnetTopupIntent):TestnetTopupIntent{
  if(!value||typeof value.id!=="string"||!value.id.trim()||value.chainId!==YNX_TESTNET_CHAIN_ID||!address(value.recipient)||!/^([1-9][0-9]*)$/.test(value.amountWei)||!Number.isSafeInteger(value.minConfirmations)||value.minConfirmations<1||Date.parse(value.expiresAt)<=Date.now())throw new Error("Card funding intent is invalid or expired");
  return Object.freeze({...value,recipient:value.recipient.toLowerCase()});
}
function address(value:unknown):value is string{return typeof value==="string"&&/^0x[0-9a-fA-F]{40}$/.test(value)}
function sameAddress(left:string,right:string):boolean{return left.toLowerCase()===right.toLowerCase()}
function parseRpcQuantity(value:string):bigint{if(!/^0x[0-9a-fA-F]+$/.test(value))throw new Error("Chain quantity is invalid");return BigInt(value)}
function toRpcQuantity(value:string):string{return `0x${BigInt(value).toString(16)}`}
function confirmationCount(head:string,block:string):number{const latest=parseRpcQuantity(head),included=parseRpcQuantity(block);if(latest<included)throw new Error("Chain head precedes top-up receipt");const count=latest-included+1n;if(count>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Top-up confirmation count is invalid");return Number(count)}

function parseSession(value:unknown):CardSession{
  if(!object(value)||value.productClientId!==CLIENT_ID||value.bundleId!==BUNDLE_ID||typeof value.token!="string"||typeof value.sessionBinding!="string"||typeof value.requestDigest!="string"||typeof value.account!="string"||!Array.isArray(value.scopes)||value.scopes.join("\n")!==SCOPES.join("\n")||typeof value.issuedAt!="string"||typeof value.expiresAt!="string"||typeof value.deviceId!="string"||Date.parse(value.expiresAt)<=Date.now())throw new Error("Central Wallet session binding is invalid");
  return Object.freeze(value as CardSession);
}
async function json(url:string,input:{method:string;body:unknown}):Promise<unknown>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);try{const response=await fetch(url,{method:input.method,headers:{"Content-Type":"application/json","X-YNX-Client":CLIENT_ID},body:JSON.stringify(input.body),signal:controller.signal});const value=await response.json().catch(()=>({error:"Invalid Gateway response"}));if(!response.ok){const failure=Object.assign(new Error(object(value)&&typeof value.error==="string"?value.error:`Gateway returned ${response.status}`),{status:response.status,code:object(value)&&typeof value.code==="string"?value.code:undefined,requestId:response.headers.get("x-request-id")??undefined,traceId:response.headers.get("x-trace-id")??undefined,errorId:response.headers.get("x-error-id")??undefined});throw failure}return value}catch(error){const failure=error instanceof Error?error:new Error("Gateway request failed");if(!("status" in failure))Object.assign(failure,{network:true});throw failure}finally{clearTimeout(timer)}}
async function productRandom():Promise<Readonly<{secret:Uint8Array;nonce:Uint8Array}>>{const crypto=await import("expo-crypto");return{secret:await crypto.getRandomBytesAsync(32),nonce:await crypto.getRandomBytesAsync(32)}}
function object(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
