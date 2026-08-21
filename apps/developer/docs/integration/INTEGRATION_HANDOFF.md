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

## Safe Wallet authorize launcher v2 boundary

Integration accepted `safeWalletAuthorizeLauncher@2.0.0-p0.0` at
`3e73d729`. Developer consumes the authoritative source
`f1ba5013a817d4c03157e1cf83d7685606951a12` with evidence source
`649107488520f0973805b32704cfe4a02e15aafa`. This supersedes the hidden-frame
candidate: Web and Extension perform EIP-6963 followed by injected EIP-1193
discovery only. They do not navigate a custom scheme, create an iframe, invoke
`window.open` or create a blank target. The Developer Web product may, after an
explicit user click, call the selected standard provider's
`eth_requestAccounts` and add/switch only the fixed YNX Testnet `0x1917`; this
is a Developer-owned EIP-1193 connection and not a YNX authorization or
Product Session. When no
unambiguous provider exists, the current page visibly offers the official YNX
Wallet download and MetaMask links.

The Wallet/Auth v2 source itself remains the accepted discovery boundary. The
explicit-click EIP-1193 connection adapter is owned by Developer and records
its own tests and browser evidence; it must not be relabeled as Wallet/Auth
approval, callback completion, Product Session migration, or central source
acceptance.

Native Developer retains its complete canonical request flow, but now resolves
the exact populated URI before opening it. Resolver success proves only a
registered handler and never an approval, callback, account, or session.
`evidence/browser/safe-wallet-authorize-launcher-v2-local-chrome-20260821.json`
records the local production-build Chrome baseline/click/tab-count proof and a
real IDE C++ execution. It is not public deployment or installed Wallet proof;
all approval, callback, session, public, signing, and store gates remain false.

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
