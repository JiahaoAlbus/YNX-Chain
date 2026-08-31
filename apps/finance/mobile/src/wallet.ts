import {DAppConnectError,StandardWalletConnection,classifyWalletError} from '@ynx/dapp-connect-sdk';
import {assertFinanceConsumerContract} from './endpoint-manifest';

export type EIP1193Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:(value:unknown)=>void)=>void;removeListener?:(event:string,listener:(value:unknown)=>void)=>void};
export type FinanceWalletConnection={account:string;chainId:string;state:'STANDARD_CONNECTED'};
export type FinanceWalletListener=(connection:FinanceWalletConnection|null,error?:Error)=>void;

function runtimeProvider(){return (globalThis as unknown as {ethereum?:EIP1193Provider}).ethereum}
const validAccount=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value);

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

/** Restores only an already-approved account; it never calls eth_requestAccounts. */
export async function restoreStandardWallet(provider:EIP1193Provider|undefined=runtimeProvider()):Promise<FinanceWalletConnection|null>{
  const manifest=assertFinanceConsumerContract();
  if(!provider)return null;
  try{
    const accounts=await provider.request({method:'eth_accounts'});
    if(!Array.isArray(accounts)||!validAccount(accounts[0]))return null;
    const chainId=await provider.request({method:'eth_chainId'});
    if(String(chainId).toLowerCase()!==manifest.evmChainHex)throw new Error('WRONG_CHAIN: Switch the selected Wallet to YNX Testnet (0x1917).');
    return {account:accounts[0],chainId:String(chainId),state:'STANDARD_CONNECTED'};
  }catch(error){throw financeConnectionError(error)}
}

/** Subscribes to standard EIP-1193 lifecycle events for the SDK-selected provider. */
export function watchStandardWallet(listener:FinanceWalletListener,provider:EIP1193Provider|undefined=runtimeProvider()):()=>void{
  if(!provider)return()=>{};
  const notify=async()=>{
    try{listener(await restoreStandardWallet(provider))}catch(error){listener(null,financeConnectionError(error))}
  };
  if(typeof provider.on!=='function')return()=>{};
  const onAccounts=()=>{void notify()},onChain=()=>{void notify()},onDisconnect=()=>listener(null,new Error('CONNECTION_REVOKED: Wallet provider disconnected.'));
  provider.on('accountsChanged',onAccounts);provider.on('chainChanged',onChain);provider.on('disconnect',onDisconnect);
  return()=>{provider.removeListener?.('accountsChanged',onAccounts);provider.removeListener?.('chainChanged',onChain);provider.removeListener?.('disconnect',onDisconnect)};
}

export function productSessionUnavailable(){
  return new Error('PRODUCT_SESSION_UNAVAILABLE: Finance private services are not activated in the accepted endpoint manifest. Your standard wallet connection remains available.');
}
