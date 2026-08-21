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

## Canonical Wallet authorize v1 boundary

Integration accepted `canonicalWalletAuthorize@1.0.0-p0.0` at
`b38489793018ff9a009cad57558b66a142495a2e`, with authoritative source
`46386ae8eeaa7633923ae762a5a9634b5eac98d9` and contract SHA-256
`e572042f18c1e32dfe86da26ee2ab52f9372c9803eae3b492c26932e50251c03`.
Developer's React transport stores the complete pending request before opening
the Wallet and calls only the package-root `encodeRequestDeepLink` and
`parseAuthorizationCallbackURL` APIs. The native adapter receives only a
populated base64url payload and rejects missing, extra, or malformed request
data. The legacy Web shell has no fallback URI or callback parser: without an
injected accepted root implementation it fails closed.

`evidence/integration/canonical-wallet-authorize-46386ae8-20260821.json`
records the accepted source binding and local release scanner. It is source and
test evidence only. Root consumption, approval/reject return, cold-start
recovery, installed/browser visibility, public deployment, and migration all
remain false until separately proven. Product Session degradation must not
disconnect the independent Standard Wallet path.

## DApp Connect SDK source boundary

`evidence/integration/dapp-connect-sdk-pr130-8cfb3265.json` records the
clean Developer SDK source candidate as a separate, draft-only handoff. It is
based on the accepted SDK base `315897e75c0ffe3e63435fe73cfec42244b851cc` and
its exact bundled-manifest delta is the five-path commit
`3437be2f3e4d174cd8a35949e08de673f31942b8`. The candidate has no public SDK
artifact, npm publication, Faucet activation, endpoint activation, installed
product proof, ComputerControl proof, or Developer product migration claim.

Developer continues to consume only the accepted Wallet/Auth root factory. It
does not consume this draft SDK candidate until Integration accepts a specific
source checkpoint; it never uses the candidate as a reason to promote Web,
macOS, Windows, AI Build, Wallet lifecycle, or public availability status.

## Requested central actions

- `29-integration`: freeze the supplied contract and test vectors.
- `02-wallet-auth`: provide a reviewed native test device/session path for the
  Developer tuple, without any secret transfer to Developer.
- `28-website`: independently test the public Developer URL and record the
  exact candidate version; do not promote unsigned desktop artifacts as current.

All exact tuples and state boundaries are machine-readable in
`release/integration/developer-contract.json` and
`docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
