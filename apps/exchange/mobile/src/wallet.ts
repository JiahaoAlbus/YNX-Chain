import {DAppConnectError, StandardWalletConnection, classifyWalletError} from '@ynx/dapp-connect-sdk';
import {createProductWalletConnection,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,type WalletConnectionCoordinator} from '@ynx-chain/wallet-auth';
import {assertExchangeConsumerContract} from './endpoint-manifest';
import {exchangeProductSessionRegistry} from './product-session-registry';

type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>};
export type CentralSession={account:string;chainId:string;state:'STANDARD_CONNECTED'};
export type ExchangePrivateSession={state:Readonly<Record<string,unknown>>;gatewayOrigin:typeof PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN};
export type ExchangePrivateCapabilities=Readonly<{
  device:Readonly<{id:string;key:string;sign:(input:Readonly<{algorithm:'p256-sha256';deviceKey:string;payload:string}>)=>string|Promise<string>}>;
  storage:Readonly<{securityLevel:'os-protected';get:(key:string)=>string|Promise<string|null>|null;set:(key:string,value:string)=>void|Promise<void>;remove:(key:string)=>void|Promise<void>}>;
  walletInstalled:()=>boolean|Promise<boolean>;
  schemeRegistered:()=>boolean|Promise<boolean>;
  openWallet:(input:Readonly<{url:string}>)=>Readonly<{opened:true}|{opened:false;code:string}>|Promise<Readonly<{opened:true}|{opened:false;code:string}>>;
}>;
let privateConnection:WalletConnectionCoordinator|null=null;

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}

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

export function productSessionUnavailable(){
  return new Error('PRODUCT_SESSION_UNAVAILABLE: Exchange private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');
}

function privateError(error:unknown){return new Error(`PRIVATE_SERVICE_DEGRADED: ${error instanceof Error?error.message:String(error)}`)}
function requirePrivateConnection(){if(!privateConnection)throw productSessionUnavailable();return privateConnection}
function session(result:Readonly<Record<string,unknown>>):ExchangePrivateSession{return {state:result.sessionState as Readonly<Record<string,unknown>>,gatewayOrigin:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}}

/**
 * Optional Product Session setup. Products may supply only OS-protected signing and
 * storage capabilities: callback, origin, session and Gateway endpoint injection are forbidden.
 */
export function configureExchangePrivateConnection(capabilities:ExchangePrivateCapabilities){
  const {device}=capabilities;
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
export async function handleExchangeWalletReturn(url:string){try{return session(await requirePrivateConnection().handleReturn(url))}catch(error){throw privateError(error)}}
export async function disconnectExchangePrivateSession(){try{if(!privateConnection)return;await privateConnection.disconnect();privateConnection=null}catch(error){throw privateError(error)}}
export function exchangeProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN}

export const beginWalletSignIn=connectStandardWallet;
export const restoreSession=async():Promise<null>=>null;
export async function beginExchangeOrder(_session?:CentralSession,_parameters?:unknown){throw productSessionUnavailable()}
