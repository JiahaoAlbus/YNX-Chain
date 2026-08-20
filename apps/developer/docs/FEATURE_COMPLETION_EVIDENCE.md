# Developer requirement, evidence and gap matrix

| Requirement | Direct current evidence | State | Remaining proof |
| --- | --- | --- | --- |
| Web IDE and isolated runtime | Candidate `bc8a37bc…`; protected transaction passed; nine-runtime/seven-LSP gate | deployed candidate | Independent external browser version capture |
| Multi-user and restart recovery | Protected gate: 12 tenant sessions plus workspace/signed-session restart checks | verified on candidate | Capacity/SLO measurement beyond release gate |
| AI Build | Protected public gate completed a hosted Planner run; approvals and audit are locally tested | verified bounded flow | Provider contract central acceptance |
| Canonical Wallet v2 consumption | Root factory only, OS-protected bridge, source package checkpoint, state-free public mount probe | integrated, not migrated | Installed/approve/reject/timeout/revoke/second-launch/network-loss device evidence |
| Wallet-authorized deployment | Legacy deployment boundary remains fail-closed when public Wallet/BFT write gates are unavailable | not promoted | Accepted v2 lifecycle plus user-approved Testnet receipt and Explorer verification |
| macOS and Windows downloads | Current macOS source `cb57e10f…` is hosted with immutable ZIP/SBOM/provenance/checksum and extracted install proof; Windows has historical unsigned cold-launch evidence | macOS current; Windows historical | Rebuild, install and host a current Windows package; add Linux x64/Docker server artifact acceptance |
| Production signing/store | No Developer ID, notarization, Authenticode or store evidence | false | Operator-held signing identities and store acceptance |
| Central integration | Contract and vectors are supplied | pending | `29-integration` acceptance |

The evidence record for the live candidate is
`evidence/public/current-public-candidate-bc8a37bc6f2b.json`. Historical
desktop artifact claims must not be read as evidence for the current web
candidate.
