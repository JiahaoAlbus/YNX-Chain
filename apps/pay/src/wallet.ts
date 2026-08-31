import {DAppConnectError,StandardWalletConnection,classifyWalletError} from '@ynx/dapp-connect-sdk';
import {canonicalJSON} from '@ynx-chain/wallet-auth/src/canonical.js';
import {launchCanonicalAuthorization} from '@ynx-chain/wallet-auth/src/authorize-launcher.js';
import {parseAuthorizationCallbackURL,parseAuthorizationRequest} from '@ynx-chain/wallet-auth/src/protocol.js';
import {WalletConnectionCoordinator,WALLET_CONNECTION_COORDINATOR_STATUS} from '@ynx-chain/wallet-auth/wallet-connection-coordinator';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_CONNECT_STATUS,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import type {AuthorizationLaunchResult,AuthorizationRequest} from '@ynx-chain/wallet-auth';
import * as SecureStore from 'expo-secure-store';
import {getRandomValues} from 'expo-crypto';
import {Linking,NativeModules,Platform} from 'react-native';
import {assertPayConsumerContract} from './endpoint-manifest';
import {payCanonicalAuthorizationRegistry} from './product-session-registry';

export type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:(value?:unknown)=>void)=>void;removeListener?:(event:string,listener:(value?:unknown)=>void)=>void;providers?:EIP1193Provider[];isMetaMask?:boolean;isYNXWallet?:boolean};
export type PayWalletProviderKind='metamask'|'ynx-wallet';
export type PayWalletProvider=Readonly<{kind:PayWalletProviderKind;name:'MetaMask'|'YNX Wallet';rdns:string;provider:EIP1193Provider}>;
export type PayWalletConnection={account:string;chainId:string;providerKind:PayWalletProviderKind;state:'STANDARD_CONNECTED';connectionState:ReturnType<typeof createStandardWalletConnectState>};
export type PayWalletDisconnectResult=Readonly<{permissionsRevoked:boolean;localOnly:boolean;accountsRemaining:number}>;
export type PayWalletAuthorization={requestId:string;status:'pending'|'approved'|'rejected'};
export type PayPrivateSession={state:Readonly<Record<string,unknown>>;authorization?:PayWalletAuthorization;fallbackActions?:AuthorizationLaunchResult['fallbackActions']};
type DeviceDescriptor={id:string;key:string};
type PaySecureDevice={descriptor:()=>Promise<DeviceDescriptor>;sign:(payload:string)=>Promise<string>};
type PayAuthorizationCapabilities=Readonly<{device:DeviceDescriptor;resolver:(url:string)=>Promise<boolean>;openWallet:(url:string)=>Promise<Readonly<{opened:true}|{opened:false;code:string}>>}>;
const CANONICAL_AUTHORIZATION_PENDING_KEY='ynx.pay.wallet-authorize.v1.pending';
/** Pay consumes the public Router coordinator surface; callback and opener serialization remain Wallet/Auth-owned. */
export const PAY_WALLET_ROUTER_HANDOFF=Object.freeze({sourceCommit:'23c21054d8c86f245b77bffb2d03cecd2b3f80cf',sourceTree:'d478c3050bd62ba072e97de63c060abc882e87c1',coordinator:WalletConnectionCoordinator.name,statuses:WALLET_CONNECTION_COORDINATOR_STATUS});
let standardWalletState=createStandardWalletConnectState();
const discoveredProviders=new Map<EIP1193Provider,PayWalletProvider>();

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}
function providerKind(provider:EIP1193Provider,rdns=''):PayWalletProviderKind|null{
  if(provider.isMetaMask===true||rdns==='io.metamask')return 'metamask';
  if(provider.isYNXWallet===true||rdns==='com.ynx.wallet')return 'ynx-wallet';
  return null;
}
function rememberProvider(provider:EIP1193Provider|undefined,rdns='',name=''){
  if(!provider)return null;const kind=providerKind(provider,rdns);if(!kind)return null;
  const descriptor:PayWalletProvider={kind,name:kind==='metamask'?'MetaMask':'YNX Wallet',rdns:rdns||(kind==='metamask'?'io.metamask':'com.ynx.wallet'),provider};
  discoveredProviders.set(provider,descriptor);return descriptor;
}
function readInjectedProviders(scope:unknown){
  const root=(scope as {ethereum?:EIP1193Provider}).ethereum;
  for(const provider of root?.providers??[])rememberProvider(provider);
  rememberProvider(root);
}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}

/** Repeated EIP-6963 discovery covers late injection without navigating or opening a tab. */
export async function discoverPayWalletProviders(scope:unknown=globalThis,milestones=[0,250,750,1500]):Promise<PayWalletProvider[]>{
  const target=scope as {addEventListener?:Function;removeEventListener?:Function;dispatchEvent?:Function;ethereum?:EIP1193Provider};
  const announce=(event:unknown)=>{const detail=(event as {detail?:{info?:{rdns?:string;name?:string};provider?:EIP1193Provider}}).detail;if(detail?.provider)rememberProvider(detail.provider,detail.info?.rdns,detail.info?.name)};
  const initialized=()=>readInjectedProviders(target);
  target.addEventListener?.('eip6963:announceProvider',announce);target.addEventListener?.('ethereum#initialized',initialized);
  try{
    let previous=0;
    for(const point of milestones){await delay(Math.max(0,point-previous));previous=point;readInjectedProviders(target);try{target.dispatchEvent?.(typeof Event==='function'?new Event('eip6963:requestProvider'):{type:'eip6963:requestProvider'})}catch{} }
    readInjectedProviders(target);return [...discoveredProviders.values()];
  }finally{target.removeEventListener?.('eip6963:announceProvider',announce);target.removeEventListener?.('ethereum#initialized',initialized)}
}
function mappedCode(code:string){
  if(['PROVIDER_REQUIRED','WALLET_UNAVAILABLE','WALLET_DISCONNECTED'].includes(code))return 'PROVIDER_UNAVAILABLE';
  if(['WRONG_NETWORK','WALLET_CHAIN_DISCONNECTED'].includes(code))return 'WRONG_CHAIN';
  if(['NETWORK_UNAVAILABLE','INVALID_GATEWAY'].includes(code))return 'RPC_UNAVAILABLE';
  if(['WALLET_OPEN_FAILED','WALLET_OPEN_TIMEOUT','SCHEME_NOT_REGISTERED'].includes(code))return 'RELAY_UNAVAILABLE';
  if(code==='CLIENT_RETIRED')return 'CLIENT_RETIRED';
  return code;
}
export function payConnectionError(error:unknown){const classified=error instanceof DAppConnectError?error:classifyWalletError(error);return new Error(`${mappedCode(classified.code)}: ${classified.message}`)}
function standardStateCode(error:unknown){const value=String(error instanceof Error&&'code'in error?(error as Error&{code?:unknown}).code:'WALLET_CONNECT_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g,'_');return /^[A-Z][A-Z0-9_]{2,63}$/.test(value)?value:'WALLET_CONNECT_FAILED'}
function standardTransition(event:Record<string,unknown>){standardWalletState=reduceStandardWalletConnectState(standardWalletState,event);return standardWalletState}

/** Standard EIP-1193 connection only; it never begins or clears a Product Session. */
export async function connectStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider(),providerKind:'metamask'|'ynx-wallet'=provider?.isMetaMask?'metamask':'ynx-wallet'):Promise<PayWalletConnection>{
  const manifest=assertPayConsumerContract();
  if(!provider)throw new Error('PROVIDER_UNAVAILABLE: No EIP-1193 provider is available. Open Pay in YNX Wallet, connect a compatible wallet, or install YNX Wallet.');
  try{
    secureRandomRuntime();
    standardTransition({type:'BEGIN',pendingIntent:authorizationNonce()});
    standardTransition({type:'PROVIDER_SELECTED',providerKind});
    const connection=new StandardWalletConnection(provider);
    await connection.connect();
    await connection.ensureYNXTestnet({addChain:{chainId:manifest.evmChainHex,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[manifest.evmRpc],blockExplorerUrls:[manifest.explorer]}});
    const account=connection.account!,chainId=await provider.request({method:'eth_chainId'});
    if(typeof chainId!=='string')throw new Error('WRONG_CHAIN: Selected Wallet did not return a chain identifier.');
    standardTransition({type:'ACCOUNT_APPROVED',account});
    const completed=standardTransition({type:'CHAIN_CONFIRMED',chainId});
    if(completed.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED)throw new Error(`WRONG_CHAIN: Pay requires YNX Testnet ${manifest.evmChainHex}.`);
    return {account:completed.account!,chainId:completed.chainId!,providerKind,state:'STANDARD_CONNECTED',connectionState:completed};
  }catch(error){try{standardTransition({type:'FAIL',code:standardStateCode(error)})}catch{}throw payConnectionError(error)}
}

/** Refresh is prompt-free: eth_accounts and eth_chainId restore or invalidate only the Standard Wallet state. */
export async function restoreStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider(),providerKind:'metamask'|'ynx-wallet'=provider?.isMetaMask?'metamask':'ynx-wallet'):Promise<PayWalletConnection|null>{
  if(!provider)return null;
  try{const [accounts,chainId]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);const restored=standardTransition({type:'RESTORE',providerKind,accounts,chainId});return restored.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?{account:restored.account!,chainId:restored.chainId!,providerKind,state:'STANDARD_CONNECTED',connectionState:restored}:null}catch{return null}
}

/** Restores all known providers prompt-free and returns only an exact 0x1917 connection. */
export async function restoreDiscoveredPayWallet(scope:unknown=globalThis){
  const providers=await discoverPayWalletProviders(scope,[0,250,750,1500]);
  for(const item of providers){const connection=await restoreStandardWallet(item.provider,item.kind);if(connection)return {connection,provider:item}}
  return null;
}

/** Provider events are the only background state updates; no account prompt is issued. */
export function observePayWallet(provider:EIP1193Provider,onConnection:(connection:PayWalletConnection|null)=>void){
  const accountsChanged=(value?:unknown)=>{try{const next=standardTransition({type:'ACCOUNTS_CHANGED',accounts:value});onConnection(next.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?{account:next.account!,chainId:next.chainId!,providerKind:next.providerKind as PayWalletProviderKind,state:'STANDARD_CONNECTED',connectionState:next}:null)}catch{onConnection(null)}};
  const chainChanged=(value?:unknown)=>{try{const next=standardTransition({type:'CHAIN_CHANGED',chainId:value});onConnection(next.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?{account:next.account!,chainId:next.chainId!,providerKind:next.providerKind as PayWalletProviderKind,state:'STANDARD_CONNECTED',connectionState:next}:null)}catch{onConnection(null)}};
  const disconnected=()=>{standardTransition({type:'PROVIDER_DISCONNECT'});onConnection(null)};
  provider.on?.('accountsChanged',accountsChanged);provider.on?.('chainChanged',chainChanged);provider.on?.('disconnect',disconnected);
  return()=>{provider.removeListener?.('accountsChanged',accountsChanged);provider.removeListener?.('chainChanged',chainChanged);provider.removeListener?.('disconnect',disconnected)};
}

/** Explicit user action. Unsupported permission revocation is reported as local-only. */
export async function disconnectStandardWallet(provider:EIP1193Provider):Promise<PayWalletDisconnectResult>{
  let permissionsRevoked=false,localOnly=false;
  try{await provider.request({method:'wallet_revokePermissions',params:[{eth_accounts:{}}]});permissionsRevoked=true}catch(error){const code=(error as {code?:unknown})?.code;if(code===-32601||code===4200)localOnly=true;else throw payConnectionError(error)}
  const accounts=await provider.request({method:'eth_accounts'}).catch(()=>[]) as unknown;
  const remaining=Array.isArray(accounts)?accounts.length:0;standardTransition({type:'DISCONNECT'});
  return {permissionsRevoked,localOnly,accountsRemaining:remaining};
}

/** Explicit switch-account action; callers must present the Wallet confirmation boundary. */
export async function switchStandardWalletAccount(provider:EIP1193Provider,kind:PayWalletProviderKind){
  try{await provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]})}catch(error){const code=(error as {code?:unknown})?.code;if(code!==-32601&&code!==4200)throw payConnectionError(error)}
  return connectStandardWallet(provider,kind);
}

/** A CORS-safe observer may annotate connection health; it never decides connectivity or opens a Wallet. */
export function reportPayRpcProbe(status:'ready'|'degraded',code='RPC_UNAVAILABLE'){return standardTransition({type:status==='ready'?'RPC_PROBE_READY':'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,...(status==='ready'?{}:{code})})}

/** MetaMask discovery remains strictly EIP-6963/EIP-1193 and never opens YNX Wallet. */
export async function connectMetaMaskWallet(provider?:EIP1193Provider):Promise<PayWalletConnection>{
  if(provider)return connectStandardWallet(provider,'metamask');
  const metaMask=(await discoverPayWalletProviders()).find(item=>item.kind==='metamask')?.provider;
  if(metaMask)return connectStandardWallet(metaMask,'metamask');
  const injected=runtimeProvider();
  if(injected?.isMetaMask)return connectStandardWallet(injected,'metamask');
  throw new Error('METAMASK_NOT_FOUND: No EIP-6963 or EIP-1193 MetaMask provider is available.');
}

export function productSessionUnavailable(){return new Error('PRODUCT_SESSION_UNAVAILABLE: Pay private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');}
function privateError(error:unknown){const message=error instanceof Error?error.message:String(error);return new Error(`PRIVATE_SERVICE_DEGRADED: ${mappedCode(error instanceof DAppConnectError?error.code:'SESSION_UNAVAILABLE')}: ${message}`)}
function secureRandomRuntime(){const cryptoValue=globalThis.crypto as Crypto|undefined;if(!cryptoValue?.getRandomValues)Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}})}
function authorizationNonce(){const bytes=new Uint8Array(32);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}
function secureDevice():PaySecureDevice{const bridge=NativeModules.PaySecureDevice as PaySecureDevice|undefined;if(Platform.OS!=='android'||!bridge?.descriptor||!bridge?.sign)throw privateError('This Pay build has no registered OS-protected P-256 signing bridge. No canonical Wallet authorization request was opened.');return bridge}
function validDescriptor(descriptor:DeviceDescriptor){if(!/^[A-Za-z0-9._:-]{8,128}$/.test(descriptor.id)||!/^[A-Za-z0-9_-]{44}$/.test(descriptor.key))throw privateError('The Pay secure-device bridge returned an invalid public key.');return descriptor}
const canonicalAuthorizationStorage={get:()=>SecureStore.getItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY),set:(value:string)=>SecureStore.setItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),remove:()=>SecureStore.deleteItemAsync(CANONICAL_AUTHORIZATION_PENDING_KEY)};

async function authorizationCapabilities():Promise<PayAuthorizationCapabilities>{
  secureRandomRuntime();
  const device=secureDevice(),descriptor=validDescriptor(await device.descriptor());
  return {device:descriptor,resolver:url=>Linking.canOpenURL(url),openWallet:async url=>{try{await Linking.openURL(url);return {opened:true} as const}catch{return {opened:false as const,code:'WALLET_OPEN_FAILED'}}}};
}
async function loadCanonicalAuthorizationPending():Promise<AuthorizationRequest|null>{
  const raw=await canonicalAuthorizationStorage.get();
  if(raw===null||raw===undefined)return null;
  try{return parseAuthorizationRequest(raw,{registry:payCanonicalAuthorizationRegistry})}
  catch(error){await canonicalAuthorizationStorage.remove();throw privateError(`The protected Pay Wallet authorization request is invalid or expired: ${error instanceof Error?error.message:String(error)}`)}
}
async function createCanonicalAuthorizationRequest(capabilities:PayAuthorizationCapabilities){
  const now=new Date(),expiresAt=new Date(now.getTime()+5*60_000);
  return parseAuthorizationRequest({
    version:'1',nonce:authorizationNonce(),chainId:'ynx_6423-1',requestingProduct:'pay',productClientId:'ynx-pay-v1',bundleId:'com.ynxweb4.pay',
    productDeviceAlgorithm:'p256-sha256',productDeviceKey:capabilities.device.key,callback:'ynxpay://wallet-auth/callback',
    scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],
    purpose:'Authorize YNX Pay on YNX Testnet. This does not approve, sign, broadcast, or settle a payment and does not create a Product Session.',issuedAt:now.toISOString(),expiresAt:expiresAt.toISOString(),
  },{now,registry:payCanonicalAuthorizationRegistry});
}
function canonicalAuthorizationSession(status:PayWalletAuthorization['status'],requestId:string):PayPrivateSession{
  const message=status==='pending'
    ?'Wallet authorization is pending. No Product Session, payment approval, signature, or chain authority has been created.'
    :status==='approved'
      ?'Wallet authorization was approved. Pay private services and payments remain separately unavailable until authoritative evidence is verified.'
      :'Wallet authorization was rejected. No Product Session, payment approval, signature, or chain authority was created.';
  return {state:{status:`authorization-${status}`,message,actions:status==='pending'?['return-to-product']:['retry']},authorization:{status,requestId}};
}
function unavailableAuthorizationSession(launch:AuthorizationLaunchResult):PayPrivateSession{
  return {state:{status:'authorization-unsupported',message:'YNX Wallet could not be resolved. No authorization, payment approval, signature, Product Session, or chain authority was created.'},fallbackActions:launch.fallbackActions};
}

/** Uses the accepted v2 root launcher; Android opens only a resolver-verified, request-bearing Wallet route. */
export async function beginPayWalletAuthorization(){
  try{
    const capabilities=await authorizationCapabilities(),request=await createCanonicalAuthorizationRequest(capabilities);
    await canonicalAuthorizationStorage.set(canonicalJSON(request));
    const launch=await launchCanonicalAuthorization(request,{platform:'android',resolver:capabilities.resolver});
    if(launch.status!=='installed'||!launch.uri){await canonicalAuthorizationStorage.remove();return unavailableAuthorizationSession(launch);}
    const opened=await capabilities.openWallet(launch.uri);
    if(opened.opened!==true){await canonicalAuthorizationStorage.remove();throw new Error(`WALLET_OPEN_FAILED: ${'code'in opened?opened.code:'Wallet did not open'}`)}
    return canonicalAuthorizationSession('pending',request.nonce);
  }catch(error){throw privateError(error)}
}
export async function restorePayWalletAuthorization(){try{const request=await loadCanonicalAuthorizationPending();return request===null?null:canonicalAuthorizationSession('pending',request.nonce)}catch(error){throw privateError(error)}}

export async function handlePayWalletReturn(url:string){
  try{
    const request=await loadCanonicalAuthorizationPending();
    if(request!==null){
      const response=parseAuthorizationCallbackURL(url,request);
      await canonicalAuthorizationStorage.remove();
      return canonicalAuthorizationSession('decision'in response&&response.decision==='rejected'?'rejected':'approved',request.nonce);
    }
    throw productSessionUnavailable();
  }catch(error){throw privateError(error)}
}
export async function disconnectPayPrivateSession(){try{await canonicalAuthorizationStorage.remove()}catch(error){throw privateError(error)}}
