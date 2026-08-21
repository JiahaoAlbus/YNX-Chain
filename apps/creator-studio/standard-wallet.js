export const WALLET_INSTALL_OPTIONS=Object.freeze([
  {id:"ynx",label:"Download YNX Wallet",url:"https://ynxweb4.com/dapp/download"},
  {id:"metamask",label:"Use MetaMask",url:"https://metamask.io/download/"}
]);

class WalletConnectionError extends Error{
  constructor(code,message,{details}={}){super(message);this.name="WalletConnectionError";this.code=code;this.details=details}
}

async function discoverProviders(windowLike,timeoutMs){
  const providers=[];
  const receive=event=>{if(event?.detail?.provider?.request&&!providers.some(item=>item.provider===event.detail.provider))providers.push(event.detail)};
  windowLike.addEventListener?.("eip6963:announceProvider",receive);
  try{
    windowLike.dispatchEvent?.(new Event("eip6963:requestProvider"));
    if(timeoutMs>0)await new Promise(resolve=>setTimeout(resolve,timeoutMs));
  }finally{windowLike.removeEventListener?.("eip6963:announceProvider",receive)}
  return providers;
}

class StandardWalletConnection{
  constructor(provider){this.provider=provider;this.listeners=[]}
  async connect(){const accounts=await this.provider.request({method:"eth_requestAccounts"});if(!Array.isArray(accounts)||!accounts[0])throw new WalletConnectionError("ACCOUNT_UNAVAILABLE","The Wallet did not return an approved account.");return{account:accounts[0]}}
  async ensureYNXTestnet({addChain}={}){
    let chainId=await this.provider.request({method:"eth_chainId"});
    if(String(chainId).toLowerCase()!=="0x1917"){
      try{await this.provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1917"}]})}
      catch(error){
        if((error?.code===4902||error?.code==="4902")&&addChain){
          await this.provider.request({method:"wallet_addEthereumChain",params:[addChain]});
          await this.provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1917"}]});
        }
        else throw error;
      }
      chainId=await this.provider.request({method:"eth_chainId"});
    }
    if(String(chainId).toLowerCase()!=="0x1917")throw new WalletConnectionError("WRONG_CHAIN","The Wallet did not switch to YNX Testnet.");
    return{chainId:"0x1917"};
  }
  on(event,listener){if(typeof this.provider.on==="function"){this.provider.on(event,listener);this.listeners.push([event,listener])}return this}
  disconnect(){for(const[event,listener]of this.listeners)this.provider.removeListener?.(event,listener);this.listeners=[]}
}

export async function connectStandardWallet({walletId,windowLike=globalThis,timeoutMs=250,network=globalThis.YNX_STANDARD_WALLET_NETWORK}={}){
  if(!["ynx","metamask"].includes(walletId))throw new WalletConnectionError("WALLET_CHOICE_REQUIRED","Choose YNX Wallet or MetaMask before requesting an account.");
  const announced=await discoverProviders(windowLike,timeoutMs);
  const matches=announced.filter(detail=>matchesWallet(detail,walletId));
  if(matches.length>1)throw new WalletConnectionError("WALLET_AMBIGUOUS",`More than one ${walletId==="ynx"?"YNX Wallet":"MetaMask"} provider was announced. Choose the intended browser profile and retry.`);
  const preferred=matches[0];
  const legacy=matchesLegacyWallet(windowLike.ethereum,walletId)?windowLike.ethereum:null;
  const provider=preferred?.provider??legacy;
  if(!provider?.request)throw new WalletConnectionError(walletId==="ynx"?"YNX_WALLET_NOT_FOUND":"METAMASK_NOT_FOUND",`${walletId==="ynx"?"YNX Wallet":"MetaMask"} was not detected in this browser.`,{details:{installOptions:WALLET_INSTALL_OPTIONS}});
  const connection=new StandardWalletConnection(provider);
  const connected=await connection.connect();
  const addChain=network?.rpcUrl?{chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNX Testnet",symbol:"YNXT",decimals:18},rpcUrls:[network.rpcUrl],blockExplorerUrls:network.explorerUrl?[network.explorerUrl]:[]}:undefined;
  const chain=await connection.ensureYNXTestnet({addChain});
  return Object.freeze({connection,providerName:preferred?.info?.name??"EVM Wallet",account:connected.account,chainId:chain.chainId,state:"STANDARD_CONNECTED"});
}

export function privateServiceDegraded({account=null,chainId=null,error=new WalletConnectionError("PRODUCT_SESSION_GATEWAY_UNREACHABLE","Private Creator service is unavailable.")}={}){
  return Object.freeze({standardConnection:Object.freeze({state:account?"STANDARD_CONNECTED":"NOT_CONNECTED",account,chainId}),privateService:Object.freeze({state:"PRIVATE_SERVICE_DEGRADED",code:error.code||"PRODUCT_SESSION_GATEWAY_UNREACHABLE",message:error.message})});
}

function matchesWallet(detail,walletId){const id=`${detail?.info?.name??""} ${detail?.info?.rdns??""}`.toLowerCase();return walletId==="ynx"?(detail?.provider?.isYNXWallet===true||id.includes("ynx")):(detail?.provider?.isMetaMask===true||id.includes("metamask"))}
function matchesLegacyWallet(provider,walletId){return walletId==="ynx"?provider?.isYNXWallet===true:provider?.isMetaMask===true}
