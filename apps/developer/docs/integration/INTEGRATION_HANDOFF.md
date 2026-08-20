# YNX Developer integration handoff

Owner: `11-developer`. Current public candidate:
`bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3`.

The Developer web service has passed its protected deployment transaction at
`/var/lib/ynx-code-candidate/deploy-evidence/20260820T155718Z-bc8a37bc6f2b`.
The service reports `0.2.0-testnet-preview-bc8a37bc6f2b-candidate`; its image
fingerprint is
`e0a8aba3b87cb995a8e5e039f0d489dda9fb0dc79c44006df030dbca28a994b8`.

## Canonical Wallet v2 boundary

Developer consumes the accepted Wallet/Auth source checkpoint
`203be5e108be468350591615a64d5d36ab87a8f1` only through
`createProductWalletConnection`. The fixed public origin is
`https://wallet-auth.ynxweb4.com`. Developer supplies only its product registry,
OS-protected storage, device signer, discovery scope and Wallet opener. It does
not provide endpoint, callback, origin, Session, clock or transport injection.

The state-free public mount probe passed for
`POST /v2/product-sessions/challenge` with a canonical fail-closed schema-v2
`400` response. This does not prove a user approval or a migrated product.
`migratedV2` remains false until the native runtime and visible installed
Lifecycle sequence are independently evidenced.

## Requested central actions

- `29-integration`: freeze the supplied contract and test vectors.
- `02-wallet-auth`: provide a reviewed native test device/session path for the
  Developer tuple, without any secret transfer to Developer.
- `28-website`: independently test the public Developer URL and record the
  exact candidate version; do not promote unsigned desktop artifacts as current.

All exact tuples and state boundaries are machine-readable in
`release/integration/developer-contract.json` and
`docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
