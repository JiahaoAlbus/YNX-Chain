import { StandardWalletConnection, discoverWalletProviders, type Revocation } from './vendor/standard-wallet-browser.mjs';
import {parseAuthorizationRequest} from '@ynx-chain/wallet-auth/src/protocol.js';
import {parseAuthorizationCallbackURL} from '@ynx-chain/wallet-auth/src/deep-link.js';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_CONNECT_STATUS,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import type {AuthorizationLaunchResult,AuthorizationRequest} from '@ynx-chain/wallet-auth';
import type {DexActionName,DexActionPayload,DexActionResponse,DexQuote} from '@ynx-chain/wallet-auth';
import {dexCanonicalAuthorizationRegistry} from './product-session-registry';

export const DEX_WALLET_CALLBACK='https://dex.ynxweb4.com/wallet-auth/callback';
export const DEX_ACTION_CALLBACK='https://dex.ynxweb4.com/wallet-action/callback';
export const WALLET_INSTALL_URL='https://www.ynxweb4.com/dapp/download';
export const WALLET_PRODUCT_URL='https://www.ynxweb4.com/dapp/wallet';
export const YNX_EVM_CHAIN=Object.freeze({chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:Object.freeze({name:'YNX Testnet',symbol:'YNXT',decimals:18}),rpcUrls:Object.freeze(['https://rpc.ynxweb4.com/']),blockExplorerUrls:Object.freeze(['https://explorer.ynxweb4.com/'])});

export type Eip1193Provider={request(input:{method:string;params?:readonly unknown[]|Record<string,unknown>}):Promise<unknown>;on?(event:'accountsChanged'|'chainChanged'|'disconnect',listener:(value?:unknown)=>void):void;removeListener?(event:'accountsChanged'|'chainChanged'|'disconnect',listener:(value?:unknown)=>void):void};
export type StandardWalletProviderKind='metamask'|'ynx-wallet';
export type DexWalletSession=Readonly<{session:Readonly<{account:string;expiresAt:string}>}>;
export type DexPrivateCapabilities=Readonly<{device:Readonly<{key:string}>;storage:Readonly<{securityLevel:'hardware-backed'|'os-protected';get:(key:string)=>string|Promise<string|null>|null;set:(key:string,value:string)=>void|Promise<void>;remove:(key:string)=>void|Promise<void>}>;scope?:unknown}>;
export type DexAuthorizationLaunch=Readonly<{status:AuthorizationLaunchResult['status'];fallbackActions:AuthorizationLaunchResult['fallbackActions'];provider?:Eip1193Provider;providerKind?:StandardWalletProviderKind;providers:Readonly<{ynxWallet?:Eip1193Provider;metaMask?:Eip1193Provider}>}>;
let privateCapabilities:DexPrivateCapabilities|null=null;
let standardWalletState=createStandardWalletConnectState();
let standardWalletRevision=0;
const STANDARD_WALLET_PROVIDER_KEY='ynx.dex.standard-wallet.v1.provider';
const CANONICAL_AUTHORIZATION_PENDING_KEY='ynx.dex.wallet-authorize.v1.pending';

/** A UI preference, never an account, permission, token or connection proof. */
export function readStandardWalletProviderPreference():StandardWalletProviderKind|null {
  try {
    const value=globalThis.localStorage.getItem(STANDARD_WALLET_PROVIDER_KEY);
    return value==='ynx-wallet'||value==='metamask'?value:null;
  } catch { return null; }
}
function rememberStandardWalletProvider(providerKind:StandardWalletProviderKind|null) {
  try {
    if(providerKind)globalThis.localStorage.setItem(STANDARD_WALLET_PROVIDER_KEY,providerKind);
    else globalThis.localStorage.removeItem(STANDARD_WALLET_PROVIDER_KEY);
  } catch { /* Storage may be unavailable; the current connection remains in memory. */ }
}

export class WalletRequestError extends Error{constructor(public code:string,message:string){super(message)}}
function unavailable(){return new WalletRequestError('PRODUCT_SESSION_UNAVAILABLE','DEX canonical Wallet authorization requires a platform-proven protected device key and storage adapter. Read-only DEX and Standard EIP-1193 Wallet connection remain available.');}
function privateError(error:unknown){return new WalletRequestError('PRIVATE_SERVICE_DEGRADED',error instanceof Error?error.message:String(error));}
function requireCapabilities(){if(!privateCapabilities)throw unavailable();return privateCapabilities;}
function nonce(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}
function standardCode(error:unknown){const value=String(error instanceof WalletRequestError?error.code:'WALLET_CONNECT_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g,'_');return /^[A-Z][A-Z0-9_]{2,63}$/.test(value)?value:'WALLET_CONNECT_FAILED'}
function standardTransition(event:Record<string,unknown>){standardWalletState=reduceStandardWalletConnectState(standardWalletState,event);return standardWalletState}

type StandardEntry={provider:Eip1193Provider;kind:StandardWalletProviderKind;client:StandardWalletConnection;stop:()=>void};
let standardEntry:StandardEntry|null=null;
let revocationTask:Promise<Revocation>|null=null;
const observers=new Map<Eip1193Provider,Set<(state:ReturnType<typeof standardWalletDetails>)=>void>>();
function selectConnection(provider:Eip1193Provider,kind:StandardWalletProviderKind):StandardEntry {
  const previous=standardEntry;standardEntry=null;
  if(previous){previous.stop();previous.client.disconnect();}
  const origin=globalThis.location.origin;
  // Never impersonate the production origin from a local HTTP page.
  const client=new StandardWalletConnection({provider,origin,metadata:{name:'YNX DEX',url:origin}});
  const entry:StandardEntry={provider,kind,client,stop:()=>{}};standardEntry=entry;revocationTask=null;
  entry.stop=client.subscribe(({event,value})=>{
    if(standardEntry!==entry)return;
    if(event==='accountsChanged')standardTransition({type:'ACCOUNTS_CHANGED',accounts:Array.isArray(value)?value:[]});
    else if(event==='chainChanged')standardTransition({type:'CHAIN_CHANGED',chainId:typeof value==='string'?value:'0x0'});
    else if(event==='disconnect'){standardTransition({type:'DISCONNECT'});rememberStandardWalletProvider(null);}
    else return;
    for(const notify of observers.get(provider)??[])notify(standardWalletState);
  });
  return entry;
}
/** The frozen SDK owns standard transport/lifecycle; this adapter selects the YNX network and projects product UI state. */
export async function connectStandardWallet(provider:Eip1193Provider,providerKind:StandardWalletProviderKind='ynx-wallet',isCurrent:()=>boolean=()=>true):Promise<string>{
  if(!provider)throw new WalletRequestError('WALLET_NOT_FOUND','No selected provider. Download YNX Wallet or install MetaMask, then retry.');
  const revision=++standardWalletRevision;
  const assertCurrent=()=>{if(revision!==standardWalletRevision||!isCurrent())throw new WalletRequestError('WALLET_REQUEST_SUPERSEDED','A newer Wallet choice replaced this request.');};
  assertCurrent();
  const entry=selectConnection(provider,providerKind);
  try {
    standardTransition({type:'BEGIN',pendingIntent:nonce()});
    standardTransition({type:'PROVIDER_SELECTED',providerKind});
    try{await entry.client.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}
    catch(error){
      assertCurrent();if((error as {code?:number})?.code!==4902)throw error;
      await entry.client.request({method:'wallet_addEthereumChain',params:[YNX_EVM_CHAIN]});assertCurrent();
      await entry.client.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});
    }
    assertCurrent();
    const chainId=await entry.client.request({method:'eth_chainId'});assertCurrent();
    if(chainId!==YNX_EVM_CHAIN.chainId)throw new WalletRequestError('WRONG_NETWORK','Selected Wallet did not switch to YNX Testnet (chain 6423).');
    const session=await entry.client.connect();assertCurrent();
    if(session.selectedChain!==YNX_EVM_CHAIN.chainId)throw new WalletRequestError('WRONG_NETWORK','Wallet network changed before account approval completed.');
    standardTransition({type:'ACCOUNT_APPROVED',account:session.selectedAccount});
    const completed=standardTransition({type:'CHAIN_CONFIRMED',chainId:session.selectedChain});
    if(completed.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED)throw new WalletRequestError('WRONG_NETWORK','Wallet did not confirm YNX Testnet.');
    rememberStandardWalletProvider(providerKind);
    return completed.account!;
  }catch(error){
    if(revision===standardWalletRevision)try{standardTransition({type:'FAIL',code:standardCode(error)});}catch{}
    if(standardEntry===entry){entry.stop();entry.client.disconnect();standardEntry=null;}
    throw error;
  }
}
export async function connectMetaMask(provider:Eip1193Provider|undefined,isCurrent:()=>boolean=()=>true):Promise<string>{return connectStandardWallet(provider as Eip1193Provider,'metamask',isCurrent);}
export async function restoreStandardWallet(provider:Eip1193Provider|undefined,providerKind:StandardWalletProviderKind,isCurrent:()=>boolean=()=>true):Promise<string|null>{
  if(!provider||!isCurrent())return null;
  const revision=++standardWalletRevision;
  let entry:StandardEntry|null=null;
  try{
    entry=selectConnection(provider,providerKind);
    const session=await entry.client.restore();
    if(revision!==standardWalletRevision||!isCurrent()||standardEntry!==entry){if(standardEntry===entry){entry.stop();entry.client.disconnect();standardEntry=null;}return null;}
    const state=standardTransition({type:'RESTORE',providerKind,accounts:session?[session.selectedAccount]:[],chainId:session?.selectedChain??'0x0'});
    return state.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?state.account:null;
  }catch{if(entry&&standardEntry===entry){entry.stop();entry.client.disconnect();standardEntry=null;}return null;}
}
export function reportDexRpcProbe(status:'ready'|'degraded',code='RPC_UNAVAILABLE'){return standardTransition({type:status==='ready'?'RPC_PROBE_READY':'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,...(status==='ready'?{}:{code})});}
export function standardWalletDetails(){return standardWalletState;}
export function disconnectStandardWallet(){
  standardWalletRevision++;rememberStandardWalletProvider(null);
  const previous=standardEntry;standardEntry=null;revocationTask=null;
  if(previous){previous.stop();previous.client.disconnect();}
  return standardTransition({type:'DISCONNECT'});
}
export function revokeStandardWallet():Promise<Revocation>{
  if(revocationTask)return revocationTask;
  const entry=standardEntry;
  if(!entry)return Promise.resolve({status:'failed',permissionRevoked:false,locallyDisconnected:true});
  const revision=++standardWalletRevision;
  const task=entry.client.revoke().then(outcome=>{
    if(revision!==standardWalletRevision||standardEntry!==entry)return {status:'superseded' as const,permissionRevoked:false,locallyDisconnected:standardWalletState.status!=='connected'};
    if(outcome.permissionRevoked){rememberStandardWalletProvider(null);standardTransition({type:'DISCONNECT'});}
    return outcome;
  }).finally(()=>{if(revocationTask===task)revocationTask=null;});
  revocationTask=task;return task;
}
export function observeStandardWallet(provider:Eip1193Provider,onChange:(state:ReturnType<typeof standardWalletDetails>)=>void){
  if(!observers.has(provider))observers.set(provider,new Set());
  observers.get(provider)!.add(onChange);
  return ()=>{observers.get(provider)?.delete(onChange);if(!observers.get(provider)?.size)observers.delete(provider);};
}

/** The host may supply only a verified device key and protected storage; no endpoint, callback or origin injection exists. */
export function configureDexPrivateConnection(capabilities:DexPrivateCapabilities){
  if(!/^[A-Za-z0-9_-]{44}$/.test(capabilities.device.key))throw new WalletRequestError('INVALID_DEVICE_KEY','DEX requires a valid P-256 public key from the protected platform adapter.');
  privateCapabilities=capabilities;
}
async function pending():Promise<AuthorizationRequest|null>{
  const raw=await requireCapabilities().storage.get(CANONICAL_AUTHORIZATION_PENDING_KEY);if(raw===null||raw===undefined)return null;
  try{return parseAuthorizationRequest(raw,{registry:dexCanonicalAuthorizationRegistry});}catch(error){await requireCapabilities().storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);throw privateError(error)}
}
/** Web never opens a custom scheme: v2 discovers a standard provider only. */
export async function beginWalletAuthorization():Promise<DexAuthorizationLaunch>{
  const discovery=await discoverWalletProviders(privateCapabilities?.scope??globalThis,1_500);
  const ynxWallet=discovery.ynx?.provider as Eip1193Provider|undefined,metaMask=discovery.metamask?.provider as Eip1193Provider|undefined;
  return {status:ynxWallet||metaMask?'provider-ready':'unsupported',fallbackActions:[],provider:ynxWallet??metaMask,providerKind:ynxWallet?'ynx-wallet':metaMask?'metamask':undefined,providers:Object.freeze({...(ynxWallet?{ynxWallet}:{}),...(metaMask?{metaMask}:{})})};
}
export async function completeWalletCallback(url:string):Promise<DexWalletSession|null>{
  try{const value=await pending();if(!value)return null;const response=parseAuthorizationCallbackURL(url,value);await requireCapabilities().storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);if('decision'in response)return null;return {session:{account:response.account,expiresAt:response.expiresAt}};}catch(error){throw error instanceof WalletRequestError?error:privateError(error)}
}
export async function restoreWalletSession():Promise<DexWalletSession|null>{if(!privateCapabilities)return null;await pending();return null;}
export async function beginDexAction(_input:{action:DexActionName;payload:DexActionPayload;quote:DexQuote;accountNonce:number}):Promise<{url:string}>{throw new WalletRequestError('NATIVE_ACTION_SIGNER_UNAVAILABLE','No installed native DEX action signer has been integrated. A Standard Wallet connection or Product Session alone does not authorize a native transaction.');}
export function consumeDexActionCallback(_url:string):DexActionResponse|null{return null;}
export function dexProductSessionGatewayOrigin(){return null;}
