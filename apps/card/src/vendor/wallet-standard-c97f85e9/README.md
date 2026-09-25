# Exact Wallet Owner standard browser consumer

This directory consumes the Wallet Owner's supplied standalone ESM artifact,
not a Card implementation of the shared protocol.

- Wallet source: `c97f85e9ae4d4580b99860c51738e6040ca9ca18`
- Wallet tree: `28a660bbe1451f0d5e20d6eb08da17eef0970d77`
- Artifact: `standard-wallet-browser.mjs`, 22417 bytes
- SHA-256: `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`
- The supplied browser manifest is preserved without edits.
- The bundle includes its dependencies; Card does not copy partial raw modules
  with unresolved bare hash imports. Embedded upstream notices are retained.
- `standard-wallet-browser.d.mts` is a type-only subset of the same source's
  declarations, not a new runtime or authorization contract.

Card consumes discovery, connection, read-only restore, events and permission
revocation through `src/standardWalletSdk.ts`. Provider discovery explicitly has
`unverified-injected-candidate` authority. A logo, RDNS, provider flag, or a mock
test does not prove an installed wallet, an approved account, or a signature.

The fixed Card origin is `https://card.ynxweb4.com`. Private Product Session
handling is separate and is not upgraded by replacing this standard SDK bundle.
