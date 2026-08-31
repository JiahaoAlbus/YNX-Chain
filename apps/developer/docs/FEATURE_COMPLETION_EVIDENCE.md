# Developer requirement, evidence and gap matrix

> **Current installer boundary (2026-08-31):** historical ZIP download records
> below are retained for audit only. The current macOS artifact is a locally
> verified DMG candidate and the current Windows artifact is a CI-installed MSIX
> candidate; both remain non-public until immutable hosting, external byte/hash
> readback, production-signing classification and rollback evidence exist.

| Requirement | Direct current evidence | State | Remaining proof |
| --- | --- | --- | --- |
| Web IDE and isolated runtime | Candidate `bc8a37bc…`; protected transaction passed; nine-runtime/seven-LSP gate | deployed candidate | Independent external browser version capture |
| Multi-user and restart recovery | Protected gate: 12 tenant sessions plus workspace/signed-session restart checks | verified on candidate | Capacity/SLO measurement beyond release gate |
| AI Build | Protected public gate completed a hosted Planner run; approvals and audit are locally tested | verified bounded flow | Provider contract central acceptance |
| Canonical Wallet v2 consumption | Root factory only, OS-protected bridge, native Keychain proof, actual absent-Wallet scheme lookup, source package checkpoint and state-free public mount probe | integrated, not migrated | Installed/approve/reject/timeout/revoke/second-launch/network-loss device evidence |
| Wallet-authorized deployment | Legacy deployment boundary remains fail-closed when public Wallet/BFT write gates are unavailable | not promoted | Accepted v2 lifecycle plus user-approved Testnet receipt and Explorer verification |
| Desktop and server downloads | Current macOS source `e01b9e4a…`, Linux x64 Server source `bc8a37bc…` and Windows x64 hosted-workspace source `6ac39fd1…` are hosted with immutable artifact evidence; Windows CI passed portable extraction, remote C++ compilation and two cold launches | macOS, Linux and Windows current unsigned Testnet Preview | Add a Docker image acceptance record |
| Production signing/store | No Developer ID, notarization, Authenticode or store evidence | false | Operator-held signing identities and store acceptance |
| Central integration | Contract and vectors are supplied | pending | `29-integration` acceptance |

The evidence record for the live candidate is
`evidence/public/current-public-candidate-bc8a37bc6f2b.json`. Historical
desktop artifact claims must not be read as evidence for the current web
candidate.
