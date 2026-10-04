# Exchange public introduction candidate

Source 0764326f4aa54b06d35e9e27222ccddef14aba7b; tree 4c57256a9d09d4292fbbd9a6a082b41bd51d9101. Contains all prior owned financial fixes and inherited complete UI; no shared Wallet/Auth code changed.

Archive `/tmp/ynx-exchange-microsite-0764326f4-linux-amd64.tar.gz`: 4719604 bytes, SHA256 63389213b14e9f5fa5a4273d3555926bde651a2898458db2ac55c61c1c5fc1cd. Linux amd64 executable 9621688 bytes, SHA256 655e1aa5b06c5f369f40f3c587a3be4de55ea47d5eb9e6a1a5d4c68a24b0ac6c. Exact21 entries include eighteen web assets and manifest/checksums/executable. Independent actual-archive positive/negative suite12 cases PASS.

Routing: `/` without query is public introduction; explicit `/app`, historical `/index.html`, callbacks and root query returns remain original app. Browser-only old hashes are handed off to `/app` and actual allowlisted app view restores on load/back-forward. No Host/Caddy change performed or required by this source handler. Shared callback/auth registrations unchanged; publisher must verify composed deployment routes and any native remote-entry mapping rather than replacing native apps with marketing.

Source-browser batch320/390/1440 × English/Chinese PASS: original Logo, actual guest screenshot, no overflow, keyboard focus, CTA/app/return/reload/language persistence. Existing Japanese preference is not overwritten by bilingual introduction. No SDK/provider/API loads on introduction, no non-GETs or extra tabs/errors. Go routing PASS; unchanged application UI regression13 PASS; new asset graph/tamper tests7 PASS; syntax/diff PASS. Screenshots and visual review: apps/exchange/design-qa.md.

Initial packaged test still assumed all files belonged to the app page and failed on the unloaded introduction screenshot. It was not ignored: the actual archive browser harness now visits both explicit app and public root, verifies introduction has no SDK/API requests and asserts the whole asset set loaded. Actual same immutable archive rerun390/1280 PASS with all eighteen assets, decoded original Logo/preview, default English, official YNX/MetaMask no-provider fallback, stable one-tab, preserved unsent draft/reload and zero page errors/non-GETs.

Public deployed=false; installed=false; actual Wallet approval/signature/transaction=false; Mac ComputerControl=false. These are local engineering/source and actual archive browser proofs only. Formal release owner A has received candidate for compatible publication and source-bound public readback; no candidate ZIP is represented as installer.
