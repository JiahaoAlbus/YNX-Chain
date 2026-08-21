# WalletConnect boundary

WalletConnect is not bundled or configured in the current YNX Browser / Wallet
preview. There is no approved WalletConnect relay, project ID, session proposal,
namespace, account, signer, or transaction path. A `wc:` or `walletconnect:` URI
must be kept in the current DApp Browser tab and reported as
`WALLETCONNECT_NOT_CONFIGURED`; it must not open a blank protocol page or create
a local session.

This does not change Standard Wallet compatibility. An EIP-1193/EIP-6963
connection remains independent and can only be called connected after the chosen
provider has returned an approved account and `eth_chainId` `0x1917`.

Any future WalletConnect activation requires a reviewed relay/project
configuration plus real website, icon, terms, privacy, and support URLs. It also
requires separate installed approval, namespace, disconnect, expiry, and
transaction evidence before it can be described as supported.
