import {DAppConnectError,StandardWalletConnection,classifyWalletError} from '@ynx/dapp-connect-sdk';
import {createProductWalletConnection,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,type WalletConnectionCoordinator} from '@ynx-chain/wallet-auth';
import * as SecureStore from 'expo-secure-store';
import {getRandomValues} from 'expo-crypto';
import {Linking,NativeModules,Platform} from 'react-native';
import {assertPayConsumerContract} from './endpoint-manifest';
import {payProductSessionRegistry} from './product-session-registry';

type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>};
export type PayWalletConnection={account:string;chainId:string;state:'STANDARD_CONNECTED'};
export type PayPrivateSession={state:Readonly<Record<string,unknown>>;gatewayOrigin:typeof PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN};
type DeviceDescriptor={id:string;key:string};
type PaySecureDevice={descriptor:()=>Promise<DeviceDescriptor>;sign:(payload:string)=>Promise<string>};
let privateConnection:WalletConnectionCoordinator|null=null;

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}
function mappedCode(code:string){
  if(['PROVIDER_REQUIRED','WALLET_UNAVAILABLE','WALLET_DISCONNECTED'].includes(code))return 'PROVIDER_UNAVAILABLE';
  if(['WRONG_NETWORK','WALLET_CHAIN_DISCONNECTED'].includes(code))return 'WRONG_CHAIN';
  if(['NETWORK_UNAVAILABLE','INVALID_GATEWAY'].includes(code))return 'RPC_UNAVAILABLE';
  if(['WALLET_OPEN_FAILED','WALLET_OPEN_TIMEOUT','SCHEME_NOT_REGISTERED'].includes(code))return 'RELAY_UNAVAILABLE';
  if(code==='CLIENT_RETIRED')return 'CLIENT_RETIRED';
  return code;
}
export function payConnectionError(error:unknown){const classified=error instanceof DAppConnectError?error:classifyWalletError(error);return new Error(`${mappedCode(classified.code)}: ${classified.message}`)}

/** Standard EIP-1193 connection only; it never begins or clears a Product Session. */
export async function connectStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider()):Promise<PayWalletConnection>{
  const manifest=assertPayConsumerContract();
  if(!provider)throw new Error('PROVIDER_UNAVAILABLE: No EIP-1193 provider is available. Open Pay in YNX Wallet, connect a compatible wallet, or install YNX Wallet.');
  try{
    const connection=new StandardWalletConnection(provider);
    await connection.connect();
    await connection.ensureYNXTestnet({addChain:{chainId:manifest.evmChainHex,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[manifest.evmRpc],blockExplorerUrls:[manifest.explorer]}});
    return {account:connection.account!,chainId:connection.chainId!,state:'STANDARD_CONNECTED'};
  }catch(error){throw payConnectionError(error)}
}

export function productSessionUnavailable(){return new Error('PRODUCT_SESSION_UNAVAILABLE: Pay private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');}
function privateError(error:unknown){const message=error instanceof Error?error.message:String(error);return new Error(`PRIVATE_SERVICE_DEGRADED: ${mappedCode(error instanceof DAppConnectError?error.code:'SESSION_UNAVAILABLE')}: ${message}`)}
function secureRandomRuntime(){const cryptoValue=globalThis.crypto as Crypto|undefined;if(!cryptoValue?.getRandomValues)Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}})}
function secureDevice():PaySecureDevice{const bridge=NativeModules.PaySecureDevice as PaySecureDevice|undefined;if(Platform.OS!=='android'||!bridge?.descriptor||!bridge?.sign)throw privateError('This Pay build has no registered OS-protected P-256 signing bridge. No Product Session request was opened.');return bridge}
function protectedStorage(){const key=(value:string)=>{if(!value.startsWith('ynx.product-session.v2:'))throw privateError('The Wallet SDK requested an unexpected protected-storage namespace.');const encoded=`ynx.pay.ps.${value.slice('ynx.product-session.v2:'.length).replace(/:/g,'.')}`;if(!/^[A-Za-z0-9._-]+$/.test(encoded))throw privateError('The Wallet SDK requested an invalid protected-storage key.');return encoded};return {securityLevel:'os-protected' as const,get:(value:string)=>SecureStore.getItemAsync(key(value)),set:(name:string,value:string)=>SecureStore.setItemAsync(key(name),value),remove:(value:string)=>SecureStore.deleteItemAsync(key(value))}}
async function coordinator(){
  if(privateConnection)return privateConnection;
  secureRandomRuntime(); const device=secureDevice(),descriptor=await device.descriptor();
  if(!/^[A-Za-z0-9._:-]{8,128}$/.test(descriptor.id)||!/^[A-Za-z0-9_-]{44}$/.test(descriptor.key))throw privateError('The Pay secure-device bridge returned an invalid public key.');
  privateConnection=createProductWalletConnection({registry:payProductSessionRegistry,productId:'pay',platform:'android',walletInstalled:()=>Linking.canOpenURL('ynxwallet://authorize'),schemeRegistered:()=>Linking.canOpenURL('ynxpay://wallet-auth/callback'),gatewayTimeoutMs:10_000,storage:protectedStorage(),device:{id:descriptor.id,key:descriptor.key,sign:({algorithm,deviceKey,payload}:{algorithm:'p256-sha256';deviceKey:string;payload:string})=>{if(algorithm!=='p256-sha256'||deviceKey!==descriptor.key)throw privateError('The Wallet SDK requested an unexpected Pay device signature.');return device.sign(payload)},scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],purpose:'Connect YNX Pay private services through the approved Wallet Product Session.'},scope:globalThis,discoveryWaitMs:250,openWallet:async({url}:{url:string})=>{try{await Linking.openURL(url);return {opened:true} as const}catch{return {opened:false as const,code:'WALLET_OPEN_FAILED'}}},openTimeoutMs:10_000});
  return privateConnection;
}
function session(result:Readonly<Record<string,unknown>>):PayPrivateSession{const state=result.sessionState;return {state:state&&typeof state==='object'?state as Readonly<Record<string,unknown>>:Object.freeze({status:'PRIVATE_SERVICE_DEGRADED',message:'Wallet SDK returned no Product Session state.'}),gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}}
/** Optional private capability: each failure leaves the Standard Wallet untouched. */
export async function beginPayPrivateSession(){try{return session(await (await coordinator()).beginYNX())}catch(error){throw privateError(error)}}
export async function retryPayPrivateSession(){try{return session(await (await coordinator()).retryYNX())}catch(error){throw privateError(error)}}
export async function restorePayPrivateSession(networkAvailable=true){try{return session(await (await coordinator()).restore(networkAvailable))}catch(error){throw privateError(error)}}
export async function handlePayWalletReturn(url:string){try{return session(await (await coordinator()).handleReturn(url))}catch(error){throw privateError(error)}}
export async function disconnectPayPrivateSession(){try{if(privateConnection){await privateConnection.disconnect();privateConnection=null}}catch(error){throw privateError(error)}}
export function payProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}
