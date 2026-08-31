# Finance non-regressive combined release handoff — 2026-08-31

This candidate keeps the intended 7824 backend exactly while preserving the seven byte-exact Standard Wallet frontend resources currently served from the 75f0299 runtime.

- Source: 4f7fba323a89ffb83a81fe2e2f2b97d23947de87 / tree 9fbf7a11fecf362ef79d331debd59938c14b1d60
- Backend authority: 7824af677dd052d20321431381523ab302614d98
- Frontend authority: 75f0299aaf53263e4279acf93e9a06db9d055e38
- Deterministic Linux archive: 3,938,517 bytes / SHA-256 55e8d98317eab27248644e6c1168e5ef9f72221a9708a8b80c0ee6502760147d
- Binary: 8,573,076 bytes / SHA-256 1a32d3f9a7f6de43fd5c44580c8a72b1068fab65bdacaa080130efa210bb8050
- Legacy wallet-connect.js is absent from the archive.
- Each of the seven preserved frontend resources has an independent negative mutation fixture.
- The executor verifies the signed build identity before and after switching and retains automatic/manual rollback fences.

No SSH, production write, deployment, account request, signature, or transaction occurred. Central must fresh-read every production tuple and inventory, freeze literal placement/deployment argv objects, and issue a new Finance-only single-use lease.
