export function validateYNXChainMutation(method,params,chain){
  const input=Array.isArray(params)&&params.length===1?params[0]:null;
  const expected=method==="wallet_addEthereumChain"?chain:{chainId:chain.chainId};
  const record=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const equal=(actual,canonical)=>Array.isArray(canonical)?Array.isArray(actual)&&actual.length===canonical.length&&actual.every((item,index)=>equal(item,canonical[index])):record(canonical)?record(actual)&&Object.keys(actual).every(key=>Object.hasOwn(canonical,key)&&equal(actual[key],canonical[key])):actual===canonical;
  if(!record(input)||input.chainId!==chain.chainId||!equal(input,expected))throw Object.assign(new Error("Rejected non-canonical YNX Testnet chain parameters."),{code:"INVALID_CHAIN_PARAMS"});
  return true;
}
