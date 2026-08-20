import {DAppConnectError, StandardWalletConnection, classifyWalletError} from '@ynx/dapp-connect-sdk';
import {assertExchangeConsumerContract} from './endpoint-manifest';

type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>};
export type CentralSession={account:string;chainId:string;state:'STANDARD_CONNECTED'};

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

export const beginWalletSignIn=connectStandardWallet;
export const restoreSession=async():Promise<null>=>null;
export async function beginExchangeOrder(_session?:CentralSession,_parameters?:unknown){throw productSessionUnavailable()}
