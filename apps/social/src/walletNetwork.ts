export const SOCIAL_NATIVE_CHAIN_ID = "ynx_6423-1" as const;
export const SOCIAL_EVM_CHAIN_ID = 6423 as const;
export const SOCIAL_EVM_CHAIN_QUANTITY = "0x1917" as const;

export function assertSocialWalletChain(chainId: unknown): asserts chainId is typeof SOCIAL_NATIVE_CHAIN_ID {
  if (chainId !== SOCIAL_NATIVE_CHAIN_ID)
    throw new Error("YNX Social Wallet authorization requires YNX chain 6423 (ynx_6423-1)");
}

export function isSocialEvmChain(chainId: unknown): chainId is typeof SOCIAL_EVM_CHAIN_QUANTITY {
  return chainId === SOCIAL_EVM_CHAIN_QUANTITY;
}
