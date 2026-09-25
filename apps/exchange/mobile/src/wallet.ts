import {DAppConnectError, StandardWalletConnection, classifyWalletError, discoverEIP6963} from '@ynx/dapp-connect-sdk';
import {canonicalJSON,createProductWalletConnection,encodeRequestDeepLink,parseAuthorizationCallbackURL,parseAuthorizationRequest,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,WALLET_AUTHORIZE_ROUTE,type AuthorizationRequest,type WalletConnectionCoordinator} from '@ynx-chain/wallet-auth';
import {getRandomValues} from 'expo-crypto';
import {assertExchangeConsumerContract} from './endpoint-manifest';
import {exchangeCanonicalAuthorizationRegistry,exchangeProductSessionRegistry} from './product-session-registry';

type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;isMetaMask?:boolean};
export type CentralSession={account:string;chainId:string;state:'STANDARD_CONNECTED'};
export type ExchangeWalletAuthorization={requestId:string;status:'pending'|'approved'|'rejected'};
export type ExchangePrivateSession={state:Readonly<Record<string,unknown>>;gatewayOrigin:typeof PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN;authorization?:ExchangeWalletAuthorization};
export type ExchangePrivateCapabilities=Readonly<{
  device:Readonly<{id:string;key:string;sign:(input:Readonly<{algorithm:'p256-sha256';deviceKey:string;payload:string}>)=>string|Promise<string>}>;
  storage:Readonly<{securityLevel:'os-protected';get:(key:string)=>string|Promise<string|null>|null;set:(key:string,value:string)=>void|Promise<void>;remove:(key:string)=>void|Promise<void>}>;
  walletInstalled:()=>boolean|Promise<boolean>;
  schemeRegistered:()=>boolean|Promise<boolean>;
  openWallet:(input:Readonly<{url:string}>)=>Readonly<{opened:true}|{opened:false;code:string}>|Promise<Readonly<{opened:true}|{opened:false;code:string}>>;
}>;
let privateConnection:WalletConnectionCoordinator|null=null;
let privateCapabilities:ExchangePrivateCapabilities|null=null;
const CANONICAL_AUTHORIZATION_PENDING_KEY='ynx.exchange.wallet-authorize.v1.pending';

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}

function secureRandomRuntime(){
  const cryptoValue=globalThis.crypto as Crypto|undefined;
  if(cryptoValue?.getRandomValues)return;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}});
}

function authorizationNonce(){
  const bytes=new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

export function exchangeConnectionError(error:unknown){
  const classified=error instanceof DAppConnectError?error:classifyWalletError(error);
  const code=classified.code==='PROVIDER_REQUIRED'?'WALLET_NOT_FOUND':classified.code==='WALLET_DISCONNECTED'?'CONNECTION_REVOKED':classified.code;
  return new Error(`${code}: ${classified.message}`);
}

/** Standard EIP-1193 only. Exchange must not bootstrap a Product Session. */
export async function connectStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider()):Promise<CentralSession>{
  const manifest=assertExchangeConsumerContract();
  if(!provider)throw new Error('WALLET_NOT_FOUND: No EIP-1193 provider is available. Open Exchange in YNX Wallet, connect a compatible wallet, or install YNX Wallet.');
  try{
    const connection=new StandardWalletConnection(provider);
    await connection.connect();
    await connection.ensureYNXTestnet({addChain:{chainId:manifest.evmChainHex,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[manifest.evmRpc],blockExplorerUrls:[manifest.explorer]}});
    return {account:connection.account!,chainId:connection.chainId!,state:'STANDARD_CONNECTED'};
  }catch(error){throw exchangeConnectionError(error)}
}

/** MetaMask discovery remains strictly EIP-6963/EIP-1193 and never opens YNX Wallet. */
export async function connectMetaMaskWallet(provider?:EIP1193Provider):Promise<CentralSession>{
  if(provider)return connectStandardWallet(provider);
  const scope=globalThis as unknown as {addEventListener?:Function;removeEventListener?:Function;dispatchEvent?:Function};
  if(scope.addEventListener&&scope.removeEventListener&&scope.dispatchEvent){
    const discovered=await discoverEIP6963(scope as {addEventListener:Function;removeEventListener:Function;dispatchEvent:Function},{timeoutMs:250}) as Array<{info?:{rdns?:string};provider?:EIP1193Provider}>;
    const metaMask=discovered.find(item=>item.info?.rdns==='io.metamask'||item.provider?.isMetaMask)?.provider;
    if(metaMask)return connectStandardWallet(metaMask);
  }
  const injected=runtimeProvider();
  if(injected?.isMetaMask)return connectStandardWallet(injected);
  throw new Error('METAMASK_NOT_FOUND: No EIP-6963 or EIP-1193 MetaMask provider is available.');
}

export function productSessionUnavailable(){
  return new Error('PRODUCT_SESSION_UNAVAILABLE: Exchange private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');
}

function privateError(error:unknown){return new Error(`PRIVATE_SERVICE_DEGRADED: ${error instanceof Error?error.message:String(error)}`)}
function requirePrivateConnection(){if(!privateConnection)throw productSessionUnavailable();return privateConnection}
function requirePrivateCapabilities(){if(!privateCapabilities)throw productSessionUnavailable();return privateCapabilities}
function session(result:Readonly<Record<string,unknown>>):ExchangePrivateSession{return {state:result.sessionState as Readonly<Record<string,unknown>>,gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}}

async function loadCanonicalAuthorizationPending(capabilities:ExchangePrivateCapabilities):Promise<AuthorizationRequest|null>{
  const raw=await capabilities.storage.get(CANONICAL_AUTHORIZATION_PENDING_KEY);
  if(raw===null||raw===undefined)return null;
  try{return parseAuthorizationRequest(raw,{registry:exchangeCanonicalAuthorizationRegistry})}
  catch(error){await capabilities.storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);throw privateError(`The protected Exchange Wallet authorization request is invalid or expired: ${error instanceof Error?error.message:String(error)}`)}
}

async function createCanonicalAuthorizationRequest(capabilities:ExchangePrivateCapabilities){
  secureRandomRuntime();
  const now=new Date(),expiresAt=new Date(now.getTime()+5*60_000);
  return parseAuthorizationRequest({
    version:'1',nonce:authorizationNonce(),chainId:'ynx_6423-1',requestingProduct:'exchange',productClientId:'ynx-exchange-v1',bundleId:'com.ynxweb4.exchange',
    productDeviceAlgorithm:'p256-sha256',productDeviceKey:capabilities.device.key,callback:'ynxexchange://wallet-auth/callback',
    scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],
    purpose:'Authorize YNX Exchange on YNX Testnet. This does not place an order, move assets, or create a Product Session.',issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString(),
  },{now,registry:exchangeCanonicalAuthorizationRegistry});
}

function canonicalAuthorizationSession(status:ExchangeWalletAuthorization['status'],requestId:string):ExchangePrivateSession{
  const message=status==='pending'
    ?'Wallet authorization is pending. No Product Session, order, or chain authority has been created.'
    :status==='approved'
      ?'Wallet authorization was approved. Exchange private services remain separately unavailable until an authoritative Product Session is verified.'
      :'Wallet authorization was rejected. No Product Session, order, or chain authority was created.';
  return {state:{status:`authorization-${status}`,message,actions:status==='pending'?['return-to-product']:['retry']},gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,authorization:{status,requestId}};
}

/** Opens only a package-generated, request-bearing Wallet authorization route. */
export async function beginExchangeWalletAuthorization(){
  try{
    const capabilities=requirePrivateCapabilities(),request=await createCanonicalAuthorizationRequest(capabilities);
    await capabilities.storage.set(CANONICAL_AUTHORIZATION_PENDING_KEY,canonicalJSON(request));
    const opened=await capabilities.openWallet({url:encodeRequestDeepLink(request)});
    if(opened.opened!==true){await capabilities.storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);throw new Error(`WALLET_OPEN_FAILED: ${'code'in opened?opened.code:'Wallet did not open'}`)}
    return canonicalAuthorizationSession('pending',request.nonce);
  }catch(error){throw privateError(error)}
}

export async function restoreExchangeWalletAuthorization(){
  try{const request=await loadCanonicalAuthorizationPending(requirePrivateCapabilities());return request===null?null:canonicalAuthorizationSession('pending',request.nonce)}catch(error){throw privateError(error)}
}

/**
 * Optional Product Session setup. Products may supply only OS-protected signing and
 * storage capabilities: callback, origin, session and Gateway endpoint injection are forbidden.
 */
export function configureExchangePrivateConnection(capabilities:ExchangePrivateCapabilities){
  const {device}=capabilities;
  privateCapabilities=capabilities;
  privateConnection=createProductWalletConnection({
    registry:exchangeProductSessionRegistry,productId:'exchange',platform:'android',
    walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,gatewayTimeoutMs:10_000,storage:capabilities.storage,
    device:{id:device.id,key:device.key,sign:({algorithm,deviceKey,payload}:{algorithm:'p256-sha256';deviceKey:string;payload:string})=>{
      if(algorithm!=='p256-sha256'||deviceKey!==device.key)throw privateError('The Wallet SDK requested an unexpected Exchange device signature.');
      return device.sign({algorithm,deviceKey,payload});
    },scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],purpose:'Connect YNX Exchange private services through the approved Wallet Product Session.'},
    scope:globalThis,discoveryWaitMs:250,openWallet:capabilities.openWallet,openTimeoutMs:10_000,
  });
  return privateConnection;
}

/** A private-session failure must never disconnect the separately connected standard Wallet. */
export async function beginExchangePrivateSession(){try{return session(await requirePrivateConnection().beginYNX())}catch(error){throw privateError(error)}}
export async function retryExchangePrivateSession(){try{return session(await requirePrivateConnection().retryYNX())}catch(error){throw privateError(error)}}
export async function restoreExchangePrivateSession(networkAvailable=true){try{return session(await requirePrivateConnection().restore(networkAvailable))}catch(error){throw privateError(error)}}
export async function handleExchangeWalletReturn(url:string){
  try{
    const capabilities=requirePrivateCapabilities(),request=await loadCanonicalAuthorizationPending(capabilities);
    if(request!==null){
      const response=parseAuthorizationCallbackURL(url,request);
      await capabilities.storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);
      return canonicalAuthorizationSession('decision'in response&&response.decision==='rejected'?'rejected':'approved',request.nonce);
    }
    return session(await requirePrivateConnection().handleReturn(url));
  }catch(error){throw privateError(error)}
}
export async function disconnectExchangePrivateSession(){try{if(privateCapabilities)await privateCapabilities.storage.remove(CANONICAL_AUTHORIZATION_PENDING_KEY);if(!privateConnection)return;await privateConnection.disconnect();privateConnection=null;privateCapabilities=null}catch(error){throw privateError(error)}}
export function exchangeProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}

export const beginWalletSignIn=connectStandardWallet;
export const restoreSession=async():Promise<null>=>null;
export async function beginExchangeOrder(_session?:CentralSession,_parameters?:unknown){throw productSessionUnavailable()}
