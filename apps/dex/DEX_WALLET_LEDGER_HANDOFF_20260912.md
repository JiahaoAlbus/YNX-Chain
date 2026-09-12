# DEX Wallet-to-ledger continuation

Owner branch: `codex/dex-wallet-restore-choice-20260912`.
Preserved source predecessor: `b94ce62391945c0ff1203d4ca20ca9e2ac04dddb`.
Report unresolved dependencies to **接续测试网生态审计工作**, task
`01a094cc-0ba3-7901-bcd5-56fce8330c0d`, not the previous audit task.

## Implemented

- Replaced the permanently empty My Positions page with a public native-ledger
  balance/asset/nonce/LP-share view. Removed the API stub that always returned an
  empty position list.
- Reads existing same-origin `/accounts/{address}`, `/dex/balances/{address}`,
  `/dex/assets`, `/dex/pools` contracts. Balances/assets/pools require exact
  `ynx-consensus-abci` / `abci-state-v13`, `failure=false`, complete coverage.
  Account, asset and LP-share ownership are validated. Missing, incomplete,
  duplicated, unsafe-number or cross-account responses fail closed, never zero.
- Amounts and proportional reserves use integer arithmetic. Large safe decimal
  strings are retained without floating-point rounding. Native YNXT whole units
  are not added to EVM wei. Mapping a checksummed YNX address to its same 20-byte
  account payload is not signing authority or proof of custody.
- Refresh and online recovery are read-only. Disconnect/account changes discard
  old data and late responses. Requests have an eight-second deadline. Portfolio
  errors do not invalidate Standard Wallet connection or reopen the chooser.
- LP reserve amounts are proportional read-only calculations, not executable
  exit quotes. Independent endpoint reads are explicitly not an atomic snapshot.
- New portfolio UI and errors have all 12 product languages. Existing unrelated
  English fallback copy elsewhere in DEX has not been represented as fully
  localized by this change.
- Connected users requesting a native action are told precisely that the native
  signer is unavailable, instead of being sent through another connect loop.
  No private session, signature, native transaction or MetaMask private method is
  invented. `beginDexAction` is explicitly `NATIVE_ACTION_SIGNER_UNAVAILABLE`.

## Verification

- `npm test`: 71/71 across 10 files. Includes two-address separation, complete vs
  unknown balances, LP arithmetic, duplicate/cross-owner/precision rejection,
  disconnect/late-response isolation, timeout, online retry, all-language copy,
  and actual App/shared-reducer preservation when ledger reads fail.
- `npm run build`: TypeScript and Vite PASS.
- `npm run verify:canonical-authorize`: PASS (18 executable source files).
- `npm run verify:legacy-route-quarantine` and `git diff --check`: PASS.
- Providers, ledger responses and accounts in automated tests are test fixtures,
  not evidence of a real account approval or public balance.

Local Web build SHA-256:

| File | SHA-256 |
| --- | --- |
| `dist/index.html` | `f47efa67224a4f19136e9644765e54c1e4963dab9d09d96c55faa48f4adf9410` |
| `dist/assets/index-C0ti0R4u.js` | `190e6be6d8fc3f1d881e72c38f4d864ac3bf271b494ffcf4ba8d477426dfe68e` |
| `dist/assets/index-D1zW4_Sh.css` | `7acf4148f07e1e010d5829eaec739b0929a141ee06c20a2ff82f88cfa979afe7` |

## Active integration dependencies, not product completion

1. Core is preparing a versioned same-ledger atomic
   `/v1/native-snapshot?account=…` with string amounts, full balances/shares and
   explicit pending/durability/finality metadata. Its exact schema/source must be
   consumed when frozen. Do not interpret the proposed Devnet snapshot as BFT
   finalized state or silently label it `abci-state-v13`.
2. Wallet owner confirmed no currently deliverable installed native-action
   signing lifecycle. The existing SDK's pure secp256k1 action signer is not an
   installed platform capability. Product-device P256 proof is separate. Native
   action approval/callback/nonce/receipt integration remains required.
3. The active public DEX is not bound to this build. A saved explicit permission
   denial prevents this task from opening the public DEX; no browser/HTTP/other
   surface workaround is authorized. No deployment or public balance/approval/
   signature/swap/liquidity/install claim is made. No deployment script ran.

Source integration is product-only. Shared Wallet, Core, Website, Calendar and
other product directories were not changed. No database migration or remote
rollback is involved in this local source checkpoint.
