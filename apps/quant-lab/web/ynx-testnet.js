export const YNX_EVM_CHAIN=Object.freeze({chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:Object.freeze({name:'YNXT',symbol:'YNXT',decimals:18}),rpcUrls:Object.freeze(['https://rpc.ynxweb4.com/']),blockExplorerUrls:Object.freeze(['https://explorer.ynxweb4.com/'])});

/**
 * Bring an explicitly selected EIP-1193 provider to YNX Testnet and verify it
 * before the caller requests account permission.
 */
export async function ensureYNXTestnet(provider){try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}catch(error){if(error?.code!==4902)throw error;await provider.request({method:'wallet_addEthereumChain',params:[YNX_EVM_CHAIN]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});}const chainId=await provider.request({method:'eth_chainId'});if(chainId!==YNX_EVM_CHAIN.chainId)throw new Error('WRONG_NETWORK: Wallet did not switch to YNX Testnet.');return chainId;}
