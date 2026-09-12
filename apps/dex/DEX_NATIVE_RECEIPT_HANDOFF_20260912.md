# DEX native receipt lookup — read-only local candidate

Source `f48b86613d1bdb709bdf9ae7d6b261af93a9446c`, tree
`d765301a55c16f3cc12f432b3ca55c87f305806c`, branch
`codex/dex-wallet-restore-choice-20260912`. Preserve predecessor `f871ea506`.
Only `apps/dex/**` changed. Coordination remains 接续测试网生态审计工作,
task `01a094cc-0ba3-7901-bcd5-56fce8330c0d`.

## Product behavior

Explore now has an explicit guest transaction-hash lookup. It issues one GET
to `/v1/native-transactions/{hash}` using Core `28d30b4b`'s exact decimal-string
receipt contract. It accepts the four native DEX swap/liquidity action types,
binds returned hash/owner/action/pool/nonce/whole-YNXT fee and checkpoint shape,
rejects HTML fallback and contradictory/malformed responses, and distinguishes
`not_found`, `memory_only`, `uncertain`, `pending_durable`, and `durable`.
These protocol status identifiers and field names are shown verbatim; the
title, input, action and risk/error explanation support all 12 existing locales.

The response is a node observation, not an independent signature verification,
token-amount proof or BFT finality. `consensusFinality` must be false. A 404 or
lost ACK does not create a new nonce/intent; this component never signs, posts,
broadcasts, requests an account or changes a Wallet connection. The original
signed intent must be retained by the later transaction workflow. No automatic
broadcast was enabled by this slice.

Eight-second timeout, newer-query generation fence, unmount cancellation,
explicit retry and network-online recovery are implemented. Recovery reads
only the same submitted hash. Explorer links use the validated hash. Opening
the panel does not query or require login. No fixture is wired into runtime.

## Tests and local visible observation

- `npm test -- --run`: **133/133**, 14 test files.
- New receipt tests: 18 parser/HTTP cases using the unchanged Core golden receipt
  and explicitly mutated negative fixtures; five rendered-component cases.
- `npm run build`: TypeScript and Vite PASS.
- `npm run verify:canonical-authorize`: PASS, 21 executable source files.
- `npm run verify:legacy-route-quarantine`, `git diff --check`: PASS.
- Computer Use opened only `http://127.0.0.1:4198/#explore`, first desktop then
  390×844, on the actual local build. Entered an all-zero non-sensitive query
  hash and observed the unavailable/invalid warning while preserving the URL,
  guest surface and closed Wallet chooser. The local 6436 proxy was absent;
  no successful chain read is claimed from this observation.
- Changed en → zh-CN via real Settings: the existing receipt error and boundary
  changed language without losing the entered hash. Restored en, reset viewport,
  closed the test tab and stopped the local preview. Inline screenshots are in
  this task's Computer Use output; no screenshot-file hash is fabricated.
- Development-mode CSS injection conflicts with the existing strict CSP. QA
  used the compiled external CSS via `vite preview`; CSP was not weakened.
  Public DEX browser denial was not bypassed.

Local artifact bytes/SHA256 (not uploaded or installed):

| Path | Bytes | SHA256 |
| --- | ---: | --- |
| dist/index.html | 931 | d7dd23b6d5ee49205513af691c7179cba121d71f3b764866077c5d3ceb72be99 |
| dist/assets/index-DNtVsbni.css | 26713 | 14fc644de2d32295b7518697c8fea05902f0ff765079f45ee782ea8beee70260 |
| dist/assets/index-Dqm87HEL.js | 372581 | 6bbe10eebdd11d4d1bce24e78c69024d920fd6c931f275272f018af70375a291 |
| dist/assets/index-Dqm87HEL.js.map | 1608549 | 67a458d263ff5d4e2859554d35e9544e57ea8278297df1bf5dc113b9ef1f9d6b |

## Open gates

Public source-bound deployment=false; public/installed provider approval=false;
real revoke/callback/signature/transaction=false; native Wallet action route
installed=false; Product Session/migrated-v2=false; public ComputerControl=false.
This is not a deploy/SSH lease. Core's compatible public atomic snapshot/receipt
release must be independently read back before DEX publication. Website owner
will receive a real immutable installer URL only after there is an actual
supported installer; a Web build/archive is not DMG/EXE/MSIX/APK.

Next native signing integration must consume fixed Wallet source `ff5b7d49`,
persist the exact request before a user-click route, verify the complete callback
against that pending request, and use a separate explicit submit confirmation.
The currently disabled legacy callback auto-broadcast path must not be enabled.
Rollback source with a normal owner-branch revert; no reset or force-push.
