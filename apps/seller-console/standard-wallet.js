import {discoverEip6963WalletProviders} from '@ynx-chain/wallet-auth/wallet-provider-discovery';
import {StandardWalletConnection,Eip1193ProviderError} from '@ynx-chain/wallet-auth/standard-wallet-connection';

export const WALLET_INSTALL_OPTIONS=Object.freeze([{id:"ynx",label:"Download YNX Wallet",url:"https://ynxweb4.com/dapp/download"},{id:"metamask",label:"Use MetaMask",url:"https://metamask.io/download/"}]);
export async function connectStandardWallet({windowLike=globalThis,timeoutMs=250,network=globalThis.YNX_STANDARD_WALLET_NETWORK,origin=windowLike.location?.origin??globalThis.location?.origin??'https://shop.ynxweb4.com'}={}){
 const discovery=await discoverEip6963WalletProviders(windowLike,timeoutMs);
 const preferred=[...discovery.candidates].filter(candidate=>!discovery.ambiguities.includes(candidate.kind)).sort((left,right)=>(left.kind==='ynx-wallet'?0:1)-(right.kind==='ynx-wallet'?0:1))[0];
 if(!preferred)throw Object.assign(new Error('No compatible standard EVM wallet was found.'),{code:'WALLET_NOT_FOUND',details:{installOptions:WALLET_INSTALL_OPTIONS}});
 const connection=new StandardWalletConnection({provider:preferred.provider,origin,metadata:{name:'YNX Seller',url:origin}});
 try{
  const connected=await connection.connect();
  const expectedAccount=connected.selectedAccount;
  const assertCurrent=()=>{if(connection.current?.selectedAccount!==expectedAccount)throw new Eip1193ProviderError(4100,'Wallet account changed during network confirmation.');};
  const target='0x1917';let chain=await connection.request({method:'eth_chainId'});assertCurrent();
  if(typeof chain!=='string'||chain.toLowerCase()!==target){
   try{await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});assertCurrent();}
   catch(error){assertCurrent();if(error.code!==4902||!network?.rpcUrl)throw error;
    await connection.request({method:'wallet_addEthereumChain',params:[{chainId:target,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[network.rpcUrl],blockExplorerUrls:network.explorerUrl?[network.explorerUrl]:[]}]});assertCurrent();
    await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});assertCurrent();
   }
  }
  chain=await connection.request({method:'eth_chainId'});assertCurrent();
  if(typeof chain!=='string'||chain.toLowerCase()!==target)throw new Eip1193ProviderError(4901,'Wallet did not confirm YNX Testnet.');
  // Refresh the SDK's selected account/chain using a silent permission read,
  // never a second grant; reject any changed account across every await.
  const confirmed=await connection.restore();assertCurrent();
  if(confirmed?.selectedAccount!==expectedAccount||confirmed.selectedChain!==target)throw new Eip1193ProviderError(4901,'Wallet network or account changed during readback.');
  return Object.freeze({connection,providerInfo:Object.freeze({name:preferred.name??'EVM Wallet',rdns:preferred.rdns}),providerName:preferred.name??'EVM Wallet',account:confirmed.selectedAccount,chainId:confirmed.selectedChain,state:'STANDARD_CONNECTED'});
 }catch(error){connection.disconnect();throw error;}
}
export function privateServiceDegraded({error=new Error('Private Seller service is unavailable.'),account=null,chainId=null}={}){return Object.freeze({standardConnection:Object.freeze({state:account?'STANDARD_CONNECTED':'NOT_CONNECTED',account,chainId}),privateService:Object.freeze({state:'PRIVATE_SERVICE_DEGRADED',code:'PRODUCT_SESSION_GATEWAY_UNREACHABLE'})})}
