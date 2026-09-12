# DEX fixed Standard Wallet lifecycle — local candidate

Report destination: 接续测试网生态审计工作
(`01a094cc-0ba3-7901-bcd5-56fce8330c0d`). Do not route back to the retired audit task.

## Source and ownership

- Branch: `codex/dex-wallet-restore-choice-20260912`.
- Runtime source: `8022fdb1994326a9cad515618e9562967b9f4541`.
- Source tree: `8bbb8b54bb1db8fa0b9049cba43d21f0ba0a0ee0`.
- Preserved atomic native-ledger checkpoint: `6b17e54369a005e46878365ae227c68b67b128d5`.
- This slice changes only `apps/dex/**`. Other products, shared Wallet, Core,
  website registration and original dirty worktrees were not edited.
- Fixed Standard SDK: `c97f85e9ae4d4580b99860c51738e6040ca9ca18`, tree
  `28a660bbe1451f0d5e20d6eb08da17eef0970d77`, 22417 bytes,
  SHA256 `b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43`.
  Unmodified ESM + seven-input manifest/metafile + noble MIT attribution retained.

## Implemented behavior

The same frozen SDK owns discovery, provider RPC, connect, restore, events,
local disconnect and remote account-permission revocation. Product code selects
the network with switch → 4902 add → re-switch → readback, then shared account
approval → second chain readback. The selected YNX or MetaMask identity stays
separate; missing saved MetaMask never substitutes YNX Wallet. Restore only
uses `eth_accounts`/`eth_chainId`, never requests new access or changes a network.
Provider replacement, disconnect, unmount and late revoke outcomes cannot
overwrite a newer selection. Private service/native snapshot failure cannot
delete Standard Wallet connection.

The details action distinguishes local disconnect from remote account revoke.
Revocation is confirmed only after the selected Wallet acknowledges
`wallet_revokePermissions` and returns an empty `eth_accounts`. Rejection,
unsupported method, network error or nonempty readback remains unconfirmed.
This is not ERC20 allowance cancellation or Product Session revocation.
New revoke outcome copy is keyed and re-rendered in all 12 existing locales.
Legacy Wallet messages still contain English-only text; complete dynamic
Wallet-message localization remains open and is not claimed here.

Guest views stay usable; the chooser supplies official YNX download and
MetaMask installation links. Web does not invoke a custom scheme, iframe or
new window. Runtime origin is the actual page origin, never a forged HTTPS
origin on local HTTP. Deterministic jsdom uses the declared HTTPS DEX origin
with test-double providers and mocked HTTP, not public runtime evidence.

## Verification

From `apps/dex`: `npm test -- --run` **110/110**, 12 files;
`npm run build` (TypeScript + Vite) PASS;
`npm run verify:canonical-authorize` PASS (18 executable source files and exact
SDK bytes); `npm run verify:legacy-route-quarantine` PASS; `git diff --check` PASS.
Tests execute product components and the unchanged shared SDK with injected
test-double providers. They include chooser close, remount, selected-provider
restore, 4902 network path, wrong chain during approval, selected-provider
revoke ACK/readback, failure outcomes, late revoke and no account requests on
remount after revoke. These are not real installed Wallet approval tests.

Local build inventory (not an installer, not uploaded):

| Path | Bytes | SHA256 |
| --- | ---: | --- |
| dist/index.html | 931 | 04527e10275fdaa1717d0f2caf2f9e938648e1e3d8ad517d9c8895bba823e34b |
| dist/assets/index-BAvxqn44.js | 362946 | 3536d270120bd0ed0981f3427960150229d817c6caa8ef272305f77e0d689fe2 |
| dist/assets/index-BAvxqn44.js.map | 1589161 | 680fb3fbf2901df567b3466d0bf89afeea8b36df45ae1debd6ab6430fbc804a7 |
| dist/assets/index-D1zW4_Sh.css | 25524 | 7acf4148f07e1e010d5829eaec739b0929a141ee06c20a2ff82f88cfa979afe7 |

## Truth and next boundary

Public deployed=false; public source-bound=false; installed=false;
real account approval/revoke=false; callback=false; signature=false;
swap/liquidity=false; Product Session=false; migrated-v2=false;
ComputerControl public proof=false. No live account/sign/transaction action
was performed. Existing DEX public browser denial was not bypassed by another
browser or network path. This slice ran no SSH and no deployment.

Next: consume Wallet's separate immutable native application-action signer
and receipt contract with explicit review, durable pending intent, exact
callback validation and a separate user submission step; do not expose an
installed capability until independently proved. Private SDK successor
`9840ef87` is independently authority-bound and must not reuse legacy records.
Core atomic snapshot must be published before this consumer's public switch.
Central alone binds public routing/rollback and site links. Local rollback is
a normal owner-branch revert to the preserved predecessor, never reset/force.
