import {createProductWalletConnection,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,type DexActionName,type DexActionPayload,type DexActionResponse,type DexQuote,type WalletConnectionCoordinator} from '@ynx-chain/wallet-auth';
import {dexProductSessionRegistry} from './product-session-registry';

export const DEX_WALLET_CALLBACK='https://dex.ynxweb4.com/wallet-auth/callback';
export const DEX_ACTION_CALLBACK='https://dex.ynxweb4.com/wallet-action/callback';
export const WALLET_INSTALL_URL='https://www.ynxweb4.com/dapp/download';
export const WALLET_PRODUCT_URL='https://www.ynxweb4.com/dapp/wallet';
export const YNX_EVM_CHAIN=Object.freeze({chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:Object.freeze({name:'YNX Testnet',symbol:'YNXT',decimals:18}),rpcUrls:Object.freeze(['https://rpc.ynxweb4.com/']),blockExplorerUrls:Object.freeze(['https://explorer.ynxweb4.com/'])});

type Eip1193Provider={request(input:{method:string;params?:readonly unknown[]|Record<string,unknown>}):Promise<unknown>};
export type DexWalletSession=Readonly<{session:Readonly<{account:string;expiresAt:string}>}>;
export type DexPrivateCapabilities=Readonly<{
  device:Readonly<{id:string;key:string;sign:(input:Readonly<{algorithm:'p256-sha256';deviceKey:string;payload:string}>)=>string|Promise<string>}>;
  storage:Readonly<{securityLevel:'hardware-backed'|'os-protected';get:(key:string)=>string|Promise<string|null>|null;set:(key:string,value:string)=>void|Promise<void>;remove:(key:string)=>void|Promise<void>}>;
  walletInstalled:()=>boolean|Promise<boolean>;schemeRegistered:()=>boolean|Promise<boolean>;
  openWallet:(input:Readonly<{url:string}>)=>Readonly<{opened:true}|{opened:false;code:string}>|Promise<Readonly<{opened:true}|{opened:false;code:string}>>;
}>;
let privateConnection:WalletConnectionCoordinator|null=null;

export class WalletRequestError extends Error{constructor(public code:string,message:string){super(message)}}
function unavailable(){return new WalletRequestError('PRODUCT_SESSION_UNAVAILABLE','DEX Product Session v2 requires a platform-proven protected device signer and storage adapter. Read-only DEX and Standard EIP-1193 Wallet connection remain available.');}
function privateError(error:unknown){return new WalletRequestError('PRIVATE_SERVICE_DEGRADED',error instanceof Error?error.message:String(error));}
function requirePrivateConnection(){if(!privateConnection)throw unavailable();return privateConnection;}

/** Standard EIP-1193 is separate from optional Product Session v2. */
export async function connectMetaMask(provider:Eip1193Provider|undefined=(globalThis as typeof globalThis&{ethereum?:Eip1193Provider}).ethereum):Promise<string>{
  if(!provider)throw new WalletRequestError('WALLET_NOT_FOUND','MetaMask was not detected. Download YNX Wallet or install MetaMask, then retry.');
  try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}catch(reason){if((reason as {code?:number})?.code!==4902)throw reason;await provider.request({method:'wallet_addEthereumChain',params:[YNX_EVM_CHAIN]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}
  const chainId=await provider.request({method:'eth_chainId'});if(chainId!==YNX_EVM_CHAIN.chainId)throw new WalletRequestError('WRONG_NETWORK','MetaMask did not switch to YNX Testnet (chain 6423).');
  const accounts=await provider.request({method:'eth_requestAccounts'});if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))throw new WalletRequestError('INVALID_ACCOUNT','MetaMask did not return a valid EVM account.');
  return accounts[0].toLowerCase();
}

/** Root-factory-only configuration; endpoint, callback, origin and session injection are absent. */
export function configureDexPrivateConnection(capabilities:DexPrivateCapabilities){
  const {device}=capabilities;
  privateConnection=createProductWalletConnection({registry:dexProductSessionRegistry,productId:'dex',platform:'web',walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,gatewayTimeoutMs:10_000,storage:capabilities.storage,device:{id:device.id,key:device.key,sign:({algorithm,deviceKey,payload}:{algorithm:'p256-sha256';deviceKey:string;payload:string})=>{if(algorithm!=='p256-sha256'||deviceKey!==device.key)throw privateError('The Wallet SDK requested an unexpected DEX device signature.');return device.sign({algorithm,deviceKey,payload});},scopes:['dex:account','dex:orders','dex:trade'],purpose:'Connect YNX DEX private services through the approved Wallet Product Session.'},scope:globalThis,discoveryWaitMs:250,openWallet:capabilities.openWallet,openTimeoutMs:10_000});
  return privateConnection;
}
function active(result:Readonly<Record<string,unknown>>):DexWalletSession|null{const state=result.sessionState;if(!state||typeof state!=='object'||(state as {status?:unknown}).status!=='connected')return null;const session=(state as {session?:unknown}).session;if(!session||typeof session!=='object'||typeof (session as {account?:unknown}).account!=='string'||typeof (session as {expiresAt?:unknown}).expiresAt!=='string')return null;return {session:{account:(session as {account:string}).account,expiresAt:(session as {expiresAt:string}).expiresAt}};}

// Existing UI calls remain adapter entrypoints. No verified protected platform
// capability means they fail closed instead of using legacy v1 routes.
export async function beginWalletAuthorization(){try{const result=await requirePrivateConnection().beginYNX();const url=(result as {url?:unknown}).url;if(typeof url!=='string')throw unavailable();return {url};}catch(error){throw error instanceof WalletRequestError?error:privateError(error)}}
export async function completeWalletCallback(url:string){try{return active(await requirePrivateConnection().handleReturn(url));}catch(error){throw error instanceof WalletRequestError?error:privateError(error)}}
export async function restoreWalletSession(){try{return active(await requirePrivateConnection().restore(true));}catch(error){if(error instanceof WalletRequestError&&error.code==='PRODUCT_SESSION_UNAVAILABLE')return null;throw privateError(error)}}
export async function beginDexAction(_input:{action:DexActionName;payload:DexActionPayload;quote:DexQuote;accountNonce:number}):Promise<{url:string}>{throw unavailable();}
export function consumeDexActionCallback(_url:string):DexActionResponse|null{return null;}
export function dexProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN;}
