# Quant Product Session v2 adapter checkpoint — 2026-08-21

Scope: `apps/quant-lab/**` only. This checkpoint consumes Wallet/Auth source
`203be5e108be468350591615a64d5d36ab87a8f1` via the 69-file, 123903-byte
package with SHA-256
`8d0e8e35d8f387948d44666efdc6322e9b57968b5987728dffbddd11b54928eb`.

Quant's browser adapter now has one optional Product Session construction path:
`createProductWalletConnection`. Its platform capability accepts only protected
signer/storage and Wallet-open probes; origin, endpoint, callback and session
injection are unavailable to callers. The root factory fixes the authoritative
origin to `https://wallet-auth.ynxweb4.com`.

`migrated-v2=false`. No browser hardware-backed/OS-protected device signer and
storage capability is proven, so private session, mandate execution and proof
generation fail closed. There is no runtime factory, public v2 route,
installed/browser approval/rejection/timeout/revoke/second-launch/network Retry,
public deployment, hosted-download, production-signature or store-release proof.
