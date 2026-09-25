# Finance final-UI verifier candidates (source-only)

Reviewed UI predecessor: `c5ba9b57be78ab86be182e02a958ca570efec926`, tree `b2994aaa45251f249430bf88a5a1eb229c8a422e`, branch `codex/finance-evm-read-session-pr193-20260924`.

| Candidate | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-c5ba9b57-20260925.json` | `43380384c7eb94791891989ca79dbcccca4b306a` | 6059 | `6f91e7e83b2cd44e3d671acaccbbf4dd1b382021d2b07846d3e1043dd2f27280` |
| `apps/finance/evidence/wallet-verifier-manifest-final-ui-c5ba9b57-20260925.json` | `40dc8b145072d83ca89264b3bc9cb4fdad603f43` | 5424 | `ca199000a12293b4c3005f31c20f403c4756c6ec381df87bafec2fe0fbb8947c` |

The first candidate passed two deterministic EVM-read bundle rebuilds; the second enumerated and SHA-256-checked all 28 current Wallet verifier inputs. The owner UI/browser/contract subset passed 63/63. The old active `wallet-verifier-manifest.json` and `verify-wallet-connect.mjs` pin are deliberately unchanged: they reject current `wallet-auth-entry.js`/UI bytes. Full Wallet verifier tests are therefore red and this candidate is **not** an accepted pin, public release, installed app, or live Wallet approval.

The proposed review boundary is the versioned candidate content, exact file diff, deterministic bundle rebuild, and explicit fail-closed pin transition. Independent review is required before changing `REVIEWED_VERIFIER_MANIFEST_SHA256`, the active manifest, or the hardcoded reviewed file/candidate path in `verify-wallet-connect.mjs`. Keep real accounts, signatures, orders, transactions, Product Session v2, public deployment, and installed-runtime claims false.
