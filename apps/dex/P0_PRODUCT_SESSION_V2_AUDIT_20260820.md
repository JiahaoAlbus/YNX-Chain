# DEX Product Session v2 adapter checkpoint — 2026-08-20

Scope: `apps/dex/**` only. This checkpoint consumes the 69-file, 123903-byte
Wallet/Auth package from `203be5e108be468350591615a64d5d36ab87a8f1`; package
SHA-256 is `8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb`.

The legacy direct Product Session endpoints were removed from the DEX wallet
adapter. Its only private-session construction path is
`createProductWalletConnection`, with a source-pinned DEX registry and no
endpoint, origin, callback, or session injection capability. Standard
EIP-1193/MetaMask remains separate.

`migrated-v2=false`. The web surface does not yet possess direct proof of a
hardware-backed or OS-protected device signer/storage capability, so it fails
closed for Product Session v2 instead of relabeling IndexedDB as protected
storage. There is no runtime factory proof, public v2 route proof, installed or
browser approval/rejection/timeout/revoke/second-launch/network Retry proof,
public deployment, hosted download, production signature, or store release.
