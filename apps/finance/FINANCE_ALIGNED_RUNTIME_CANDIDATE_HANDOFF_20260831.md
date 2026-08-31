# Finance aligned runtime candidate — 2026-08-31

`P0-304` is blocked before lease issuance. Its `7824af6` archive would replace the currently public `75f` Finance frontend with divergent assets.

The source-only replacement is commit `55a8483f55c095c6cd32ca9076a32a90e530d85e`: it retains the `7824af677dd052d20321431381523ab302614d98` backend and exactly preserves the seven public `75f0299aaf53263e4279acf93e9a06db9d055e38` frontend resources. The local Linux amd64 archive is 3,957,529 bytes with SHA-256 `ee939ceae83773e900326aabbb265e1040d35145e4b33af6d3c60c10b41c440f`; a second deterministic build produced the same hash. It is local, unsigned, not hosted, and not deployed.

No `P0-304` stdin, argv, observer, or request object is reusable: all are bound to the divergent archive and stale dynamic host receipts. Central must first issue a wholly-new Finance-only **zero-write** prewrite lease. That prewrite must bind the current frontend bytes, runtime/config/service receipts, and unique parent/path tuples. Only then may a successor regenerate and sign fresh execution objects.

No SSH, remote write, deployment, Wallet approval, signature, or transaction occurred for this candidate.
