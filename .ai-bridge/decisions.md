# YNX Shop decisions

## 2026-07-27

1. Buyer deletion fails closed while any order remains non-terminal.
2. Finalized order records are pseudonymized rather than deleted because accounting, fraud, refund, dispute and integrity continuity remain applicable.
3. Public-chain payer addresses and transaction hashes are retained unchanged; rewriting authoritative chain evidence would be false and would break reconciliation.
4. `reviewed` is not terminal because a delivered/reviewed order may still enter return or dispute flows.
5. Privacy deletion requires the exact confirmation phrase `DELETE_MY_SHOP_DATA` on every client.
6. The existing staging deployment and hosted artifacts remain attributed to source `38e2f68`; current commits are not marked deployed or hosted.
7. Missing scanner dependencies must never yield a successful security gate. Node.js is the bounded fallback for placeholder and secret scans.
8. Android/iOS source verification is distinct from build, install, production signing and store release.
9. Native privacy copy is maintained in the twelve audited Android resource catalogs and synchronized into the iOS string catalog; verification rejects missing translations, English fallback and non-Arabic RTL privacy strings.
