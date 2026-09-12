# Fixed Standard Wallet browser closure

The unmodified `standard-wallet-browser.mjs`, `browser-manifest.json` and
`browser-metafile.json` come from Wallet-owner source
`c97f85e9ae4d4580b99860c51738e6040ca9ca18`, tree
`28a660bbe1451f0d5e20d6eb08da17eef0970d77`.
The manifest binds all seven actual build inputs. There are no external imports.
The adjacent declaration is a product-owned TypeScript adapter, not SDK logic.

The closure includes @noble/hashes; its MIT attribution is preserved in
`NOBLE_HASHES_LICENSE`. This does not relicense YNX Wallet source. Product tests
check the exact 22417-byte closure SHA-256 before release. The legacy pinned
Wallet package is retained only for the existing UI-state projection and
quarantined private/action types, not Standard transport/discovery.

Source consumption and mocked provider tests do not prove installation, real
approval, public deployment, Product Session, signing or a transaction.
