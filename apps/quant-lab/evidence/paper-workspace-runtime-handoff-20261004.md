# Exact Quant Paper read-consumer runtime candidate

Source commit `718cc15e457cd2e0fe477e4fd5ae1437d5d7ede7`, tree `6629d855186b1b575cbd91b17b969d0abee08d00`, branch `codex/quant-paper-workspace-consumer-20261001`. Force-false push succeeded. This candidate adds the completed separate Paper read/approval/revoke panel to the original account-bound Paper worktree. It is not a replacement for previously frozen microsite assets or an instruction to overwrite another source graph; the microsite/current shared producer and this consumer must be composed explicitly before formal release.

Frozen local command:

```
node apps/quant-lab/scripts/package-runtime-candidate.mjs --commit 718cc15e457cd2e0fe477e4fd5ae1437d5d7ede7 --output /tmp/ynx-quant-paper-718cc15e4-linux-amd64.tar.gz
```

Result: Linux amd64 ELF, exact source/version linker binding, bundle rebuilt from current source, exact HTML hashes verified, 19 archive entries (16 Web files + binary + manifest + SHA256SUMS). Build/package passed; no remote invocation.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `/tmp/ynx-quant-paper-718cc15e4-linux-amd64.tar.gz` | 3723237 | `5c9eb642479b8a9fcfd9c9d279ddb5ed257153a226fa2970aa635a9dbbb62718` |
| `ynx-quantd` | 8188088 | `294d68ae2bc67e042fab0104bd3dc616150b5e0409db29f49322e59cb2436c62` |
| `BUNDLE_MANIFEST.json` | 6690 | `89052d31024fffb1400ef173aa01365f27c18908b680002403f4395f0eba4835` |
| `SHA256SUMS` | 1798 | `6f920e434840ef17929006c5072c33e04725f78a1b66716ae754f48810815764` |
| `wallet-auth.js` | 384732 | `2b8c4e9e6ea01f8f0e2e7d38b9c6f08b7dbbc64f2b528ef003489e21f87309c0` |
| `index.html` | 23364 | `06be5eca78ea7992cf725557d2daff016f3c2ec334faf927f82d55ff0ff315de` |

Local unit/browser/full-test evidence and limitations are in `paper-workspace-consumer-20261004.md`. No installed/public runtime acceptance is inferred. This archive is an engineering server candidate, not a user desktop installer. Formal Host activation remains A's sole-write workflow and must preserve the unresolved UNKNOWN upload boundary.

Rollback scope: this turn changed no live service/config/state, so no production rollback is performed. Source can retain predecessor `823809a61e58717df4d5b0d247ea2a6491d69770` without deleting sidecar data. Existing account-bound backend evidence records old-reader compatibility; it does not authorize restoring an old database snapshot. Real approved Paper write forms, full microsite composition, source-bound publication/installed Wallet joint flow and user acceptance remain open.
