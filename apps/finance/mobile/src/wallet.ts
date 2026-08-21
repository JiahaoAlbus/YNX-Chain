import {DAppConnectError,StandardWalletConnection,classifyWalletError} from '@ynx/dapp-connect-sdk';
import {canonicalJSON,createProductWalletConnection,encodeRequestDeepLink,parseAuthorizationCallbackURL,parseAuthorizationRequest,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,WALLET_AUTHORIZE_ROUTE,type AuthorizationRequest,type ProductSessionState,type WalletConnectionCoordinator} from '@ynx-chain/wallet-auth';
import * as SecureStore from 'expo-secure-store';
import {getRandomValues} from 'expo-crypto';
import {Linking,NativeModules,Platform} from 'react-native';
import {assertFinanceConsumerContract} from './endpoint-manifest';
import {financeCanonicalAuthorizationRegistry,financeProductSessionRegistry} from './product-session-registry';

type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:(value:unknown)=>void)=>void;removeListener?:(event:string,listener:(value:unknown)=>void)=>void};
export type FinanceWalletConnection={account:string;chainId:string;state:'STANDARD_CONNECTED'};
export type FinanceWalletAuthorization={requestId:string;status:'pending'|'approved'|'rejected'};
export type FinancePrivateSession={state:ProductSessionState;gatewayOrigin:typeof PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN;authorization?:FinanceWalletAuthorization};
type DeviceDescriptor={id:string;key:string};
type FinanceSecureDevice={descriptor:()=>Promise<DeviceDescriptor>;sign:(payload:string)=>Promise<string>};
let privateConnection:WalletConnectionCoordinator|null=null;
const CANONICAL_AUTHORIZATION_PENDING_KEY='ynx.finance.wallet-authorize.v1.pending';

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}

export function financeConnectionError(error:unknown){
  const classified=error instanceof DAppConnectError?error:classifyWalletError(error);
  const code=classified.code==='PROVIDER_REQUIRED'?'WALLET_NOT_FOUND':classified.code==='WALLET_DISCONNECTED'?'CONNECTION_REVOKED':classified.code;
  return new Error(`${code}: ${classified.message}`);
}

/** Standard EIP-1193 only. Product Session is deliberately never started here. */
export async function connectStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider()):Promise<FinanceWalletConnection>{
  const manifest=assertFinanceConsumerContract();
  if(!provider)throw new Error('WALLET_NOT_FOUND: No EIP-1193 provider is available. Open Finance in YNX Wallet, connect a compatible wallet, or install YNX Wallet.');
  try{
    const connection=new StandardWalletConnection(provider);
    await connection.connect();
    await connection.ensureYNXTestnet({addChain:{chainId:manifest.evmChainHex,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[manifest.evmRpc],blockExplorerUrls:[manifest.explorer]}});
    return {account:connection.account!,chainId:connection.chainId!,state:'STANDARD_CONNECTED'};
  }catch(error){throw financeConnectionError(error)}
}

export function productSessionUnavailable(){
  return new Error('PRODUCT_SESSION_UNAVAILABLE: Finance private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');
}

function privateError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return new Error(`PRIVATE_SERVICE_DEGRADED: ${message}`);
}

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

function secureDevice():FinanceSecureDevice{
  const bridge=NativeModules.FinanceSecureDevice as FinanceSecureDevice|undefined;
  if(Platform.OS!=='android'||!bridge?.descriptor||!bridge?.sign)throw privateError('This Finance build has no registered OS-protected P-256 signing bridge. No Wallet authorization request was opened.');
  return bridge;
}

function protectedStorage(){
  const key=(value:string)=>{
    if(!value.startsWith('ynx.product-session.v2:'))throw privateError('The Wallet SDK requested an unexpected protected-storage namespace.');
    const encoded=`ynx.finance.ps.${value.slice('ynx.product-session.v2:'.length).replace(/:/g,'.')}`;
    if(!/^[A-Za-z0-9._-]+$/.test(encoded))throw privateError('The Wallet SDK requested an invalid protected-storage key.');
    return encoded;
  };
  return {
    securityLevel:'os-protected' as const,
    get:(value:string)=>SecureStore.getItemAsync(key(value)),
    set:(name:string,value:string)=>SecureStore.setItemAsync(key(name),value),
    remove:(value:string)=>SecureStore.deleteItemAsync(key(value)),
  };
}

async function loadCanonicalAuthorizationPending():Promise<AuthorizationRequest|null>{
  const raw=await SecureStore.getItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY);
  if(raw===null)return null;
  try{return parseAuthorizationRequest(raw,{registry:financeCanonicalAuthorizationRegistry})}
  catch(error){await SecureStore.deleteItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY);throw privateError(`The protected Wallet authorization request is invalid or expired: ${error instanceof Error?error.message:String(error)}`)}
}

async function createCanonicalAuthorizationRequest(){
  secureRandomRuntime();
  const descriptor=await secureDevice().descriptor();
  const now=new Date(),expiresAt=new Date(now.getTime()+5*60_000);
  return parseAuthorizationRequest({
    version:'1',nonce:authorizationNonce(),chainId:'ynx_6423-1',requestingProduct:'finance',productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',
    productDeviceAlgorithm:'p256-sha256',productDeviceKey:descriptor.key,callback:'ynxfinance://wallet-auth/callback',
    scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],
    purpose:'Authorize YNX Finance on YNX Testnet. This does not create custody, a trade, or a Product Session.',issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString(),
  },{now,registry:financeCanonicalAuthorizationRegistry});
}

function canonicalAuthorizationSession(status:FinanceWalletAuthorization['status'],requestId:string):FinancePrivateSession{
  const message=status==='pending'
    ?'Wallet authorization is pending. No Product Session or chain authority has been created.'
    :status==='approved'
      ?'Wallet authorization was approved. Finance private services remain separately unavailable until an authoritative Product Session is verified.'
      :'Wallet authorization was rejected. No Product Session or chain authority was created.';
  return {state:{status:`authorization-${status}`,message,actions:status==='pending'?['return-to-product']:['retry']},gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,authorization:{status,requestId}};
}

/** Opens only the Wallet/Auth package-generated, request-bearing authorization route. */
export async function beginFinanceWalletAuthorization(){
  try{
    const request=await createCanonicalAuthorizationRequest();
    // The complete canonical request is protected before any external Activity is opened.
    await SecureStore.setItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY,canonicalJSON(request));
    const url=encodeRequestDeepLink(request);
    try{await Linking.openURL(url)}catch(error){await SecureStore.deleteItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY);throw error}
    return canonicalAuthorizationSession('pending',request.nonce);
  }catch(error){throw privateError(error)}
}

/** Restores only protected pending metadata; it never treats it as an approved session. */
export async function restoreFinanceWalletAuthorization(){
  try{const request=await loadCanonicalAuthorizationPending();return request===null?null:canonicalAuthorizationSession('pending',request.nonce)}catch(error){throw privateError(error)}
}

async function coordinator(){
  if(privateConnection)return privateConnection;
  secureRandomRuntime();
  const device=secureDevice(),descriptor=await device.descriptor();
  if(!/^[A-Za-z0-9._:-]{8,128}$/.test(descriptor.id)||!/^[A-Za-z0-9_-]{44}$/.test(descriptor.key))throw privateError('The Finance secure-device bridge returned an invalid public key.');
  privateConnection=createProductWalletConnection({
    registry:financeProductSessionRegistry,productId:'finance',platform:'android',
    walletInstalled:()=>Linking.canOpenURL(WALLET_AUTHORIZE_ROUTE),schemeRegistered:()=>Linking.canOpenURL('ynxfinance://wallet-auth/callback'),
    gatewayTimeoutMs:10_000,storage:protectedStorage(),device:{id:descriptor.id,key:descriptor.key,sign:({algorithm,deviceKey,payload}:{algorithm:'p256-sha256';deviceKey:string;payload:string})=>{
      if(algorithm!=='p256-sha256'||deviceKey!==descriptor.key)throw privateError('The Wallet SDK requested an unexpected Finance device signature.');
      return device.sign(payload);
    },scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Connect YNX Finance private services through the approved Wallet Product Session.'},
    scope:globalThis,discoveryWaitMs:250,openWallet:async({url}:{url:string})=>{
      try{await Linking.openURL(url);return {opened:true} as const}catch{return {opened:false as const,code:'WALLET_OPEN_FAILED'}}
    },openTimeoutMs:10_000,
  });
  return privateConnection;
}

function session(result:{sessionState:ProductSessionState}):FinancePrivateSession{return {state:result.sessionState,gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}}

/** Optional private capability: a failure never changes the Standard Wallet connection. */
export async function beginFinancePrivateSession(){try{return session(await (await coordinator()).beginYNX())}catch(error){throw privateError(error)}}
export async function retryFinancePrivateSession(){try{return session(await (await coordinator()).retryYNX())}catch(error){throw privateError(error)}}
export async function restoreFinancePrivateSession(networkAvailable=true){try{return session(await (await coordinator()).restore(networkAvailable))}catch(error){throw privateError(error)}}
export async function handleFinanceWalletReturn(url:string){
  try{
    const request=await loadCanonicalAuthorizationPending();
    if(request!==null){
      const response=parseAuthorizationCallbackURL(url,request);
      await SecureStore.deleteItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY);
      return canonicalAuthorizationSession('decision'in response&&response.decision==='rejected'?'rejected':'approved',request.nonce);
    }
    return session(await (await coordinator()).handleReturn(url));
  }catch(error){throw privateError(error)}
}
export async function disconnectFinancePrivateSession(){try{await SecureStore.deleteItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY);if(!privateConnection)return;await privateConnection.disconnect();privateConnection=null}catch(error){throw privateError(error)}}
export function financeProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}
