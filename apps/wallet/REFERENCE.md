# Standards and product references

Normative engineering references, reviewed 2026-07-22:

- [ERC-4337 Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337) and [ERC-7769 Bundler JSON-RPC](https://eips.ethereum.org/EIPS/eip-7769): UserOperation, EntryPoint, nonce domains, validation simulation, Bundler and Paymaster boundaries.
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/): passkey/public-key credential semantics. A passkey authenticates a bounded account action; it is not a transferable Wallet seed.
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) and [Bitstring Status List 1.0](https://www.w3.org/TR/vc-bitstring-status-list/): issuer/holder/verifier separation, expiry and privacy-preserving status checks.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [OAuth 2.0 Security BCP (RFC 9700)](https://www.rfc-editor.org/info/rfc9700/) and [DPoP (RFC 9449)](https://www.rfc-editor.org/info/rfc9449/): exact redirect binding, least privilege and sender-constrained sessions. YNX Product Sessions are not generic bearer tokens.
- [WalletConnect Wallet SDK documentation](https://docs.walletconnect.network/wallet-sdk/android/usage): external compatibility only. WalletConnect namespaces never replace YNX registry, approval, Gateway introspection or revoke authority.

Product references are MetaMask and Rabby for transaction review, Phantom for clear network/activity presentation, Apple Wallet for hierarchy and restraint, and platform passkey UX for device-bound confirmation. No third-party brand asset or proprietary implementation is copied.
