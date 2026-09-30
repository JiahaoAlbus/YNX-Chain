const record=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const ownKeys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
const trustedSubset=(value,allowed)=>Array.isArray(value)&&value.length>0&&value.length<=allowed.length&&new Set(value).size===value.length&&value.every(url=>typeof url==="string"&&allowed.includes(url));

// Requests cannot replace the Wallet's endpoints or grant account permissions.
export const YNX_CHAIN_INPUT_POLICY_VERSION=1;
export function validateYNXChainMutation(method,params,chain){
  const input=Array.isArray(params)&&params.length===1?params[0]:null;
  let valid=record(input)&&input.chainId===chain.chainId;
  if(method==="wallet_switchEthereumChain")valid=valid&&ownKeys(input,["chainId"]);
  else if(method==="wallet_addEthereumChain"){
    valid=valid&&ownKeys(input,["chainId","chainName","nativeCurrency","rpcUrls","blockExplorerUrls"])
      &&trustedSubset(input.rpcUrls,chain.rpcUrls)
      &&(!Object.hasOwn(input,"chainName")||input.chainName===chain.chainName)
      &&(!Object.hasOwn(input,"blockExplorerUrls")||trustedSubset(input.blockExplorerUrls,chain.blockExplorerUrls));
    if(valid&&Object.hasOwn(input,"nativeCurrency")){
      const currency=input.nativeCurrency;
      valid=ownKeys(currency,["name","symbol","decimals"])
        &&[chain.nativeCurrency.name,"YNXT"].includes(currency.name)
        &&currency.symbol===chain.nativeCurrency.symbol&&currency.decimals===chain.nativeCurrency.decimals;
    }
  }else valid=false;
  if(!valid)throw Object.assign(new Error("Rejected non-canonical YNX Testnet chain parameters."),{code:"INVALID_CHAIN_PARAMS"});
  return true;
}
