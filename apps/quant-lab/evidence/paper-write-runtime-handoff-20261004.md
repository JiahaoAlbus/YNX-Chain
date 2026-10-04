# Reviewed native Paper write consumer — exact runtime candidate

Source `8cb0e75ead6895e2db18bbb42025679d84f24015`, tree `d0c3be7e857bdaab2b478ac7b66c5335d243a302`, branch `codex/quant-paper-workspace-consumer-20261001`. Source force-false pushed. This supersedes the read-only `718cc15e` candidate for the native Paper consumer, not the separate microsite/current producer composition.

```
node apps/quant-lab/scripts/package-runtime-candidate.mjs --commit 8cb0e75ead6895e2db18bbb42025679d84f24015 --output /tmp/ynx-quant-paper-8cb0e75ea-linux-amd64.tar.gz
```

Linux amd64 ELF + 18 Web files + manifest/SHA256SUMS = 21 archive entries. Current wallet entry was independently rebuilt by the packager and matched the final HTML asset pins. Version linker input is the exact source SHA above. No SSH or formal deployment was performed.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `/tmp/ynx-quant-paper-8cb0e75ea-linux-amd64.tar.gz` | 3735706 | `dc21b732e19878fa4e620bb182735f37975f8254070b6d9aa58cb054598f4b59` |
| `ynx-quantd` | 8188088 | `f41a65c1ac26a4c145a10c9fd25bce35f67f80294044048bae7119a5b96552e7` |
| `BUNDLE_MANIFEST.json` | 7127 | `6209470e0cb2c0b55a00bc00892846462c55c086a1a3394483dcdbce4f8abf01` |
| `SHA256SUMS` | 2002 | `2f6775a6b2245b1edaf8d7080e053b5a6d32a181fd424a3ad81ee9163ca64b6f` |
| `wallet-auth.js` | 402841 | `ecca748cb82c9174b301992e8bdbadd65e7c728f78a5b98f0ce3729b50054042` |
| `index.html` | 24652 | `ee658305823ca6a1cfa2879542d9b730a0f84ee2dd7cd943216fc2d38bf20773` |

Local exact tests and model/risk boundaries: `paper-workspace-write-flow-20261004.md`. Source tests/build are PASS; public/installed/real Provider approval/real Product Session/real engine-from-browser/user acceptance remain false. Archive is an engineering server candidate, never a Windows/macOS installer.

No live rollback needed: this turn wrote no remote state. Preserve all previous native Paper sidecar/legacy tenant state and unresolved intent keys; do not restore an old database snapshot or clear account data to roll back a UI. A formal publisher must compose current consumer/producer/microsite into a single source graph, bind fresh deployment/rollback state and exact service configuration, and return real public identity before owner acceptance flows. Previous remote UNKNOWN stays protected.

Concrete internal backend input still required: native-workspace kill/reconcile are not exposed by the accepted three-route Paper adapter. The old browser-local risk buttons must not be repurposed to claim native account protection. Ask the existing backend/contract writer to freeze exact supported owner-bound routes/scopes and durable semantics plus two-user/restart tests; this owner then consumes them. No new financial authority or scheduling permission is inferred.
