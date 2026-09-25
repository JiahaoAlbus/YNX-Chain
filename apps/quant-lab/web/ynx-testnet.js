import {METAMASK_EVM_CHAIN} from '../../../packages/wallet-auth/src/metamask-evm-adapter.js';

export const YNX_EVM_CHAIN=METAMASK_EVM_CHAIN;

/**
 * Bring an explicitly selected EIP-1193 provider to YNX Testnet and verify it
 * before the caller requests account permission.
 */
export async function ensureYNXTestnet(provider, assertCurrent = () => {}) {
  assertCurrent();
  try { await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]}); }
  catch(error) {
    assertCurrent();
    if(error?.code!==4902)throw error;
    await provider.request({method:'wallet_addEthereumChain',params:[YNX_EVM_CHAIN]});
    assertCurrent();
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_EVM_CHAIN.chainId}]});
  }
  assertCurrent();
  const chainId=await provider.request({method:'eth_chainId'});
  assertCurrent();
  if(chainId!==YNX_EVM_CHAIN.chainId)throw new Error('WRONG_NETWORK: Wallet did not switch to YNX Testnet.');
  return chainId;
}
