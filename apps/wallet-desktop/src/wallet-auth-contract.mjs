// Source-bound read-only projection of packages/wallet-auth/src/protocol.js.
// It does not define or extend Wallet/Auth; the test suite rejects drift from the frozen package.
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit: "7a3947d0302e923ecf7699e76a5fb443fbdf4f70",
  sourcePath: "packages/wallet-auth/src/protocol.js",
  sourceSha256: "b5f7bebaeacd7f128f5d2aaabc46dfc5dfd3a1359fe46eaecb7be28f7e91776a"
});

export const YNX_EVM_CHAIN_ID = 6423;
export const YNX_TESTNET_CHAIN_QUANTITY = `0x${YNX_EVM_CHAIN_ID.toString(16)}`;
