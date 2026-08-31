# DEX standard-wallet restore checkpoint — 2026-08-31

Status: DEX-only source/build checkpoint. No account approval, Wallet callback,
Product Session, token approval, swap, liquidity action, Testnet transaction,
public source-bound runtime, installed package, or ComputerControl evidence is
claimed.

## Source behavior

The Web DEX consumes the accepted EIP-6963/EIP-1193 discovery and connect-state
reducer without opening a custom scheme or blank tab.

- On startup it discovers a provider and restores only an already approved
  account through `eth_accounts` and `eth_chainId`; it never calls
  `eth_requestAccounts` during restoration.
- The explicit YNX Wallet button selects only the discovered YNX Wallet
  provider. The explicit MetaMask button selects only the discovered MetaMask
  provider. A missing provider leaves guest/read-only DEX data available and
  provides the official installation path.
- Both providers retain the required `wallet_switchEthereumChain` → `4902`
  `wallet_addEthereumChain` → re-switch → `eth_chainId` → account request
  flow when the user explicitly connects.
- Existing connection details, disconnect and switch-provider controls remain
  driven by the shared reducer. Product Session degradation remains separate
  from a standard Wallet connection.

## Verification

At this checkpoint, `npm test` passes 33/33, `npm run build` passes, and both
`verify:canonical-authorize` and `verify:legacy-route-quarantine` pass.

## Remaining evidence gates

An independent DEX deployment lease must bind this source to a public runtime
before any browser claim. Real installed/public evidence must then separately
cover provider choice, approve/reject, 0x1917 add/switch/readback, chooser
close, refresh, account/chain events, disconnect/revoke, no blank tabs and the
Wallet Product Session lifecycle. Testnet transaction, swap, liquidity and
token-approval evidence remain separate user-confirmed actions.
