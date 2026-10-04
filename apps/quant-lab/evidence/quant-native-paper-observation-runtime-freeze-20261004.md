# Native observation successor runtime freeze

Source e38ad379bf0721d9dca1bdf64cc55b23d3f076f8
Tree f7ac41b91a7b1d28933de26b80dc7a58a557866d
Branch codex/quant-paper-microsite-composition-20261004
Release ynx-quant-lab-e38ad379bf07

Archive /tmp/ynx-quant-composed-e38ad379b-linux-amd64.tar.gz
3938366 bytes; SHA256 b92748bd54372652a1b674a620d34dbfbf716bd741d4f2dde6c2030581edd44c
Binary: 8331448 bytes; SHA256 a15c45cfc163b3c4ae95e4f4f96059ad7afc98a5e27f3643bdde5258386e0fe3
Manifest: 5580 bytes; SHA256 3d6cc5319a5fa50ed9f17989a2a36fa15704065081a59b76c58fba9aa6d3ae3e
SHA256SUMS: 1267 bytes; SHA256 0d20073e559f9e164e1295fd459ff6d23c5946d02c4f743dbdfadba7edc5c758
wallet-auth.js: 472106 bytes; SHA256 58801fbde150c27522ea540a9aaba2a208fc9c4041496298cf4069fec859bd23
index.html: 33245 bytes; SHA256 7aa7858acd410f99eedd71e9efb5d7dba43ce909368e4948822bc4706058b62c

Exact binary + 11 Web assets + manifest/checksums. Clean source and asset identity/ELF64 x86-64 verified by original packager. Cross-build only, not Linux runtime execution.

Final full Node: 332 total, 331 PASS, 0 FAIL, 1 hosted Wallet environment SKIP; 105545.707084 ms. Original failed full run and observation-race correction are preserved in quant-native-paper-observation-fences-20261004.md, not retrospectively greened.
Full Go race: quantlab PASS55.166 s / server PASS1.869 s.
Affected Go receipt/HTTP/lookup race PASS5.128 s; affected reader/model17PASS; actual original button/controller Chrome plus native journey PASS; syntax/gofmt/diff and six asset pins PASS.

Actual packaged local guest Chrome widths320/390/1280: 11 assets loaded, pageErrors=[], nonGET0, tab1, English default, preferences restore. Controlled private-session/button results are local fixtures, not real Wallet approval. Screenshots retained at screenshots/native-observation-e38ad379b:
- quant-320.png 74112 bytes; e557cd51eeb55b9471bc3a10dd226bea6c0309f1ce4d82c97de8561e1cd78f11
- quant-390.png 80354 bytes; 1daf16a83a7bf1aafe992b9fef6137bce262d0857a442da699515ba198200f53
- quant-1280.png 140999 bytes; 0004aca91281c2b93b5c5ca132a02dbdc6b18cd5b42f2da1b47865de6a217b2c

## Formal release handoff

Inherit this whole binary/Web successor, not 88ce/a556 as findings-closed. No shared SDK changes or DB schema migration. bounded_v2 consumer requires matching service support; never deploy Web-only. Preserve original cost-compatible immutable predecessors, and separately bind current durable state + exact rollback binary at release time; legacy cost-incompatible code is not a valid rollback.

Formal publisher remains A/wallet_release_owner. No SSH/upload/Host mutation/public change occurred. Public runtime, installers, real Provider approval/callback, signatures, transactions, production signing and Mac ComputerControl remain false/NOT_VERIFIED. Original native scope does not authorize scheduling or live capital; this successor does not widen it.
