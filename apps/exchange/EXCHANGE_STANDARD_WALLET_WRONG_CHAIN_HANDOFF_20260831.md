# Exchange Standard Wallet wrong-chain boundary — 2026-08-31

This source checkpoint keeps Exchange's Web Standard Wallet flow provider-only and separates it from the unavailable Exchange Product Session/API.

- The selected EIP-1193 provider must complete the existing `wallet_switchEthereumChain` → optional `4902` `wallet_addEthereumChain` → second switch sequence.
- Exchange now reads `eth_chainId` before `eth_requestAccounts`. A provider that remains off `0x1917` returns `wrong-chain` and receives no account permission request.
- The connection dialog retains separate YNX Wallet/MetaMask controls and adds an explicit **Reconnect selected wallet** action. It is user initiated; the source checkpoint contains no account approval result.
- Event-driven wrong-chain state is rendered honestly rather than as a missing-provider condition. Public market surfaces stay available, but Product Session, API, order authority, deposits, withdrawals, signing, matching and settlement remain unavailable/unproven.

## Local source evidence

| Item | Result |
| --- | --- |
| `npm test` | 14/14 pass, including wrong-chain no-account-request sequence |
| `npm run test:browser` | 3/3 no-provider/layout tests pass |
| `npm run verify:wallet-connect` | pass; no custom scheme, frame, blank target, or browser RPC prerequisite |
| rebuilt `web/wallet-connect.js` | 19,750 bytes; SHA-256 `d99a05561eb9d639937ffe8f62935cd499695728444a2505440b4fca130f6591` |

This is source/build evidence only. It is not a public runtime binding, installed-wallet approval/rejection, callback, signature, order, matching, settlement, or Testnet transaction proof. A separate Exchange-only deployment lease and source-bound browser evidence remain required.
