import {canonicalJSON} from '@ynx-chain/wallet-auth/src/canonical.js';
import {launchWebAuthorization} from '@ynx-chain/wallet-auth/src/authorize-launcher.js';
import {parseAuthorizationRequest} from '@ynx-chain/wallet-auth/src/protocol.js';
import {parseAuthorizationCallbackURL} from '@ynx-chain/wallet-auth/src/deep-link.js';
import type {AuthorizationLaunchResult,AuthorizationRequest} from '@ynx-chain/wallet-auth';
import type {DexActionName,DexActionPayload,DexActionResponse,DexQuote} from '@ynx-chain/wallet-auth';
import {dexCanonicalAuthorizationRegistry} from './product-session-registry';

export const DEX_WALLET_CALLBACK='https://dex.ynxweb4.com/wallet-auth/callback';
export const DEX_ACTION_CALLBACK='https://dex.ynxweb4.com/wallet-action/callback';
export const WALLET_INSTALL_URL='https://www.ynxweb4.com/dapp/download';
export const WALLET_PRODUCT_URL='https://www.ynxweb4.com/dapp/wallet';
export const YNX_EVM_CHAIN=Object.freeze({chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:Object.freeze({name:'YNX Testnet',symbol:'YNXT',decimals:18}),rpcUrls:Object.freeze(['https://rpc.ynxweb4.com/']),blockExplorerUrls:Object.freeze(['https://explorer.ynxweb4.com/'])});

export type Eip1193Provider={request(input:{method:string;params?:readonly unknown[]|Record<string,unknown>}):Promise<unknown>};
export type DexWalletSession=Readonly<{session:Readonly<{account:string;expiresAt:string}>}>;
export type DexPrivateCapabilities=Readonly<{device:Readonly<{key:string}>;storage:Readonly<{securityLevel:'hardware-backed'|'os-protected';get:(key:string)=>string|Promise<string|null>|null;set:(key:string,value:string)=>void|Promise<void>;remove:(key:string)=>void|Promise<void>}>;scope?:unknown}>;
export type DexAuthorizationLaunch=Readonly<{status:AuthorizationLaunchResult['status'];fallbackActions:AuthorizationLaunchResult['fallbackActions'];provider?:Eip1193Provider}>;
let privateCapabilities:DexPrivateCapabilities|null=null;
const CANONICAL_AUTHORIZATION_PENDING_KEY='ynx.dex.wallet-authorize.v1.pending';

export class WalletRequestError extends Error{constructor(public code:string,message:string){super(message)}}
function unavailable(){return new WalletRequestError('PRODUCT_SESSION_UNAVAILABLE','DEX canonical Wallet authorization requires a platform-proven protected device key and storage adapter. Read-only DEX and Standard EIP-1193 Wallet connection remain available.');}
function privateError(error:unknown){return new WalletRequestError('PRIVATE_SERVICE_DEGRADED',error instanceof Error?error.message:String(error));}
function requireCapabilities(){if(!privateCapabilities)throw unavailable();return privateCapabilities;}
function nonce(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}

/** Standard EIP-1193/MetaMask stays independent of YNX Wallet authorization. */
export async function connectStandardWallet(provider:Eip1193Provider):Promise<string>{
  if(!provider)throw new WalletRequestError('WALLET_NOT_FOUND','No EIP-1193 provider was detected. Download YNX Wallet or install MetaMask, then retry.');
  try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}catch(reason){if((reason as {code?:number})?.code!==4902)throw reason;await provider.request({method:'wallet_addEthereumChain',params:[YNX_EVM_CHAIN]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}
  const chainId=await provider.request({method:'eth_chainId'});if(chainId!==YNX_EVM_CHAIN.chainId)throw new WalletRequestError('WRONG_NETWORK','MetaMask did not switch to YNX Testnet (chain 6423).');
  const accounts=await provider.request({method:'eth_requestAccounts'});if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))throw new WalletRequestError('INVALID_ACCOUNT','MetaMask did not return a valid EVM account.');
  return accounts[0].toLowerCase();
}
/** MetaMask remains an independent explicit EIP-1193 route. */
export async function connectMetaMask(provider:Eip1193Provider|undefined=(globalThis as typeof globalThis&{ethereum?:Eip1193Provider}).ethereum):Promise<string>{return connectStandardWallet(provider as Eip1193Provider)}

/** The host may supply only a verified device key and protected storage; no endpoint, callback or origin injection exists. */
export function configureDexPrivateConnection(capabilities:DexPrivateCapabilities){
  if(!/^[A-Za-z0-9_-]{44}$/.test(capabilities.device.key))throw new WalletRequestError('INVALID_DEVICE_KEY','DEX requires a valid P-256 public key from the protected platform adapter.');
  privateCapabilities=capabilities;
}
async function pending():Promise<AuthorizationRequest|null>{
  const raw=await requireCapabilities().storage.get(CANONICAL_AUTHORIZATION_PENDING_KEY);if(raw===null||raw===undefined)return null;
  try{return parseAuthorizationRequest(raw,{registry:dexCanonicalAuthorizationRegistry});}catch(error){await requireCapabilities().storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);throw privateError(error)}
}
async function request(){
  const now=new Date(),expiresAt=new Date(now.getTime()+5*60_000),capabilities=requireCapabilities();
  return parseAuthorizationRequest({version:'1',nonce:nonce(),chainId:'ynx_6423-1',requestingProduct:'dex',productClientId:'ynx-dex-v1',bundleId:'com.ynxweb4.dex',productDeviceAlgorithm:'p256-sha256',productDeviceKey:capabilities.device.key,callback:DEX_WALLET_CALLBACK,scopes:['dex:account','dex:orders','dex:trade'],purpose:'Authorize YNX DEX on YNX Testnet. This does not approve a swap, liquidity change, token approval, Product Session, or chain transaction.',issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString()},{now,registry:dexCanonicalAuthorizationRegistry});
}

/** Web never opens a custom scheme: v2 discovers a standard provider only. */
export async function beginWalletAuthorization():Promise<DexAuthorizationLaunch>{
  try{const capabilities=privateCapabilities;const value=capabilities?await request():undefined as unknown as AuthorizationRequest;const launch=await launchWebAuthorization(value,{scope:capabilities?.scope??globalThis,waitMs:1_500});return {status:launch.status,fallbackActions:launch.fallbackActions,provider:launch.providerCandidate?.provider as Eip1193Provider|undefined};}catch(error){throw error instanceof WalletRequestError?error:privateError(error)}
}
export async function completeWalletCallback(url:string):Promise<DexWalletSession|null>{
  try{const value=await pending();if(!value)return null;const response=parseAuthorizationCallbackURL(url,value);await requireCapabilities().storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);if('decision'in response)return null;return {session:{account:response.account,expiresAt:response.expiresAt}};}catch(error){throw error instanceof WalletRequestError?error:privateError(error)}
}
export async function restoreWalletSession():Promise<DexWalletSession|null>{if(!privateCapabilities)return null;await pending();return null;}
export async function beginDexAction(_input:{action:DexActionName;payload:DexActionPayload;quote:DexQuote;accountNonce:number}):Promise<{url:string}>{throw unavailable();}
export function consumeDexActionCallback(_url:string):DexActionResponse|null{return null;}
export function dexProductSessionGatewayOrigin(){return null;}
