# Callback is not submission authority

Runtime source `a1e6c809bb9cecb4c35e7c50a781e9ba67b5c11a`, tree
`853afb61424901b5fb7e75067cb316fa1f91860d`; owner branch
`codex/dex-wallet-restore-choice-20260912`. Source-only corrective successor to
receipt checkpoint `98de793a437ce1bc8ef1c0c9726ddcf56388c80a`.

Removed the dormant native callback automatic POST from App's mount effect.
The old action parser had returned null, so that path was not currently
executable; this correction ensures a future signer integration cannot silently
turn a URL callback into a broadcast. Both the old action callback pathname and
the canonical `applicationActionResult` query stop at a clear submission-review
boundary, with zero account request/signature/POST. Future fixed-SDK parsing
must bind the persisted request and display a separate explicit submit action.

Also removed private callback/session restoration's writes to the displayed
Standard Wallet account. Only selected-provider lifecycle can establish that
account; a private session does not grant a Standard connection.

`npm test -- --run`: **135/135**, 14 files. Added two rendered callback negative
cases; all network calls stay GET/read-only. `npm run build`, canonical source
scanner and `git diff --check`: PASS. Prior local receipt visible observations
remain predecessor observations; not restated as new public/installed proof.

| Local artifact | Bytes | SHA256 |
| --- | ---: | --- |
| dist/index.html | 931 | 271d0134e232dc6935f2f5698ce1a5997123717d662be59de313c3eb4bd208c5 |
| dist/assets/index-0QULr_ZM.js | 369872 | 72f7d1d6dcceab003cb428f65b6a4a7755cd52c3aea08a5bd29bc03072fe847a |
| dist/assets/index-0QULr_ZM.js.map | 1604958 | 5a15aac8794fe8efa5b1637e9d498682cf077334695a507215964e2cecf079a8 |
| dist/assets/index-DNtVsbni.css | 26713 | 14fc644de2d32295b7518697c8fea05902f0ff765079f45ee782ea8beee70260 |

Public/installed/real approval/revoke/callback/signature/transaction/Product
Session/migrated-v2 remain false. No SSH or production writes. Central must
first read back compatible Core deployment and bind the independent DEX public
release. Public browser denial is preserved. Next signer consumption is from
Wallet `ff5b7d49`, not a second signing implementation. Report to 接续测试网生态审计工作
(`01a094cc-0ba3-7901-bcd5-56fce8330c0d`) only.
