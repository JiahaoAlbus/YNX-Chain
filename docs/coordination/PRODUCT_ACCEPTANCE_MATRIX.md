# Product Acceptance Matrix

This is the total-controller inventory for the 23 independent YNX products. It
does not convert a candidate branch, screenshot, test report, or folder into an
accepted product. Every row remains below `integrated into main` until its exact
diff is reviewed, central contracts are implemented, and the resulting artifact
is built and installed from the integrated commit.

## Status vocabulary

Only these progressive states may be used: `not implemented`, `candidate
branch`, `candidate incomplete`, `reviewed and rejected`, `reviewed and
accepted`, `integrated into main`, `locally packaged`, `installed and tested`,
`remotely deployed`, `publicly available`, `production signed`, and `externally
accepted`. A later state never follows automatically from an earlier state.

## Worktree audit (2026-07-16)

- Registered: 15/15 product worktrees. Each reports
  `/Users/huangjiahao/Desktop/YNX Chain/.git` as its common Git directory, the
  exact declared `codex/ecosystem-*` branch, origin
  `https://github.com/JiahaoAlbus/YNX-Chain.git`, and a clean status.
- Invalid or unregistered product worktrees: none found among the 15 declared
  product paths.
- Migration required: none. Desktop location is valid because the directories
  are registered worktrees rather than copied product repositories.
- Exception to the earlier intake list: Exchange is clean at
  `ff2b6b4ea877a0f708aff5fedc24b3fc7f40762d`, which supersedes the initially
  reported `ee1c3f41656be403633d01468ec79af702deb7bf` for the next review. It must
  not be reset to the older candidate.
- `/Users/huangjiahao/Desktop/YNX`, website repositories, key backup, screenshots,
  and unrelated Desktop directories are not classified as product worktrees by
  this audit and were not modified or deleted.

## Gate keys

`WF` primary workflow; `PS` persistence; `RR` restart recovery; `AZ`
authorization; `RP` replay rejection; `TP` tamper rejection; `UX`
loading/empty/failure/retry/offline/unavailable; `PV` privacy; `AU` audit; `AC`
accessibility; `AI` product-specific AI workflow; `WA` Sign in with YNX Wallet;
`GW` central Gateway; `RS` real chain/service source; `L10N` all 12 required
languages, locale formatting, persisted selection, localized accessibility, and
Arabic RTL.

For every row below, a gate not explicitly shown as independently passed is
`candidate incomplete`. Candidate handoff evidence is not installation,
deployment, public availability, production signing, or external acceptance.

## Product inventory

| Product | Thread branch and current candidate | Worktree / Git | Current state | Core gates | Platform target and current evidence | Integration / localization | Rework owner and largest blocker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YNX Wallet | `codex/ecosystem-wallet-auth` `51cf0da1fb30ee1c1a093a1ec8f43d544e54d061` | registered, clean, fetched | candidate incomplete; candidate package/install evidence exists | candidate evidence for WF/PS/RR/AZ/RP/TP/UX/PV/AU/AC; total-controller integration rerun required | Android package/emulator candidate evidence; iOS Hermes only; macOS/Windows/Web not product targets | central verifier/registry not in main; L10N incomplete | Wallet thread: central verifier contract, native iOS evidence, 12-language/RTL gate |
| YNX Social | `codex/ecosystem-social` `7f034342be9ed5eab3765c42238b22fb66673205` | registered, clean, fetched | candidate incomplete | WF/PS/RR/AZ/RP/TP/UX/PV/AU/AC/AI require full lifecycle rerun | Android/iOS target; Hermes candidate; no accepted install | legacy auth must migrate to WA/GW; L10N incomplete | Social thread: canonical Wallet envelope, full social/moderation lifecycle, native install |
| YNX Pay | `codex/ecosystem-pay` `fd5016b6e0a2aee8eed1201a726366806abf2503` | registered, clean, fetched | candidate incomplete | all core gates require central lifecycle proof | Android/iOS target; candidate client only | temporary Wallet adapter; real RS payment/receipt/refund and L10N incomplete | Pay thread: WA/GW plus committed Testnet payment/refund proof |
| Merchant Console | same Pay candidate | registered, clean, fetched | candidate incomplete | merchant WF/PS/RR/AZ/RP/TP/UX/PV/AU/AC/AI incomplete centrally | Web-first build candidate; not deployed/public | WA/GW/Pay RS and L10N incomplete | Pay thread: invoice/webhook/refund/dispute/reconciliation closure |
| YNX Exchange | `codex/ecosystem-exchange` `ff2b6b4ea877a0f708aff5fedc24b3fc7f40762d` | registered, clean, fetched | candidate incomplete | custody, order, recovery, RP/TP and truthful unavailable states require review | Android/iOS target; professional Web/desktop companion optional; no accepted install | WA/GW/indexer/custody controls and L10N incomplete | Exchange thread: exact live sources and no-fake-liquidity boundary |
| YNX Shop | `codex/ecosystem-shop` `a3aa37007a55736496f811faccae8fae7e5bfdf2` | registered, clean, fetched | candidate incomplete | plaintext persisted bearer session blocks AZ/PV; remaining gates need rerun | Android/iOS target; candidate buyer client; no accepted install | WA/GW/Pay/Trust and L10N incomplete | Shop thread: replace bearer storage and prove order-to-refund lifecycle |
| Seller Console | same Shop candidate | registered, clean, fetched | candidate incomplete | seller inventory/order/fulfilment/refund gates incomplete centrally | Web-first candidate; not deployed/public | WA/GW/Pay/Trust and L10N incomplete | Shop thread: seller authorization, inventory, fulfilment and audit closure |
| YNX Developer | `codex/ecosystem-developer` `5dddb2ac827da01051e83424e660335002ba9f6c` | registered, clean, fetched | candidate incomplete; locally packaged candidate | IDE candidate tests passed at intake; integrated WF/AZ/RP/TP/RS pending | Web IDE candidate; ad-hoc macOS ZIP only; Windows and signed releases absent | WA/GW and POST-body AI incomplete; L10N incomplete | Developer thread: real Wallet-only deploy flow and macOS/Windows installable clients |
| YNX Explorer | `codex/ecosystem-explorer-monitor` `2e5ef561c5ae782b9e5dfaff0ca5a013df390423` | registered, clean, fetched | candidate incomplete | candidate live-data/SSE gates; dependency security blocker | Web-first; candidate build only; no public deployment | exact RPC/Indexer source integration and L10N incomplete | Explorer/Monitor thread: Vite advisory, live source and stale/reconnect proof |
| YNX Monitor | same Explorer/Monitor candidate | registered, clean, fetched | candidate incomplete | RBAC/alerts/incidents/logs/backup/audit candidate; central deployment proof absent | protected Web-first operator console; no public claim | protected auth/GW and L10N incomplete | Explorer/Monitor thread: security upgrade and protected operator deployment contract |
| YNX AI | `codex/ecosystem-ai` `5d8ff21f6b7999a441754e0c30b4b2ae9ef0b0bf` | registered, clean, fetched | candidate incomplete | conversation/tool approval gates candidate; provider success absent | Android/iOS target; Web companion optional; no accepted native install | WA/GW; prompt-bearing GET must become POST; L10N incomplete | AI thread: native clients, provider failure truth, scoped tool approval, i18n |
| YNX Trust Center | `codex/ecosystem-trust-resource` `ae210bffbcd6d8c80de2615b46f4edcc8d5b3974` | registered, clean, fetched | candidate incomplete | evidence/appeal/transparency candidate; authoritative integration pending | Web-first public evidence/appeal; no deployment | WA/GW/Trust RS; POST AI and L10N/legal semantics incomplete | Trust/Resource thread: authoritative governance APIs and no-native-freeze rule |
| YNX Resource Market | same Trust/Resource candidate | registered, clean, fetched | candidate incomplete | quote/intent/status/recovery/audit need integrated proof | Web-first market; no deployment | WA/GW/Pay/Resource RS and L10N incomplete | Trust/Resource thread: no-fake-settlement and authoritative resource accounting |
| YNX Music | `codex/ecosystem-music` `74f315e368658aa0db3528b737f8c8b53fee75f7` | registered, clean, fetched | candidate incomplete | catalog/playback/offline/creator/rights/payment gates need full review | Android/iOS target; desktop optional; no accepted install | WA/GW/AI/Pay/Trust and L10N incomplete | Music thread: native media lifecycle and truthful licensed test catalog |
| YNX Video | `codex/ecosystem-video` `8dc10dcbc047299c8d322be7d9431fc5325b9416` | registered, clean, fetched | candidate incomplete | viewer/upload/comment/report/recovery candidate; production media pipeline absent | Android/iOS target; no accepted install | WA/GW/AI/Trust/Pay/storage and L10N incomplete | Video thread: scanner/transcoder/storage interfaces and truthful test media |
| Creator Studio | same Video candidate | registered, clean, fetched | candidate incomplete | upload/subtitle/moderation/copyright/revenue states incomplete centrally | Web-first candidate; not deployed/public | WA/GW/AI/Trust/Pay and L10N incomplete | Video thread: creator workflow, approval/audit and no-fake-revenue boundary |
| YNX Cloud | `codex/ecosystem-cloud-docs` `82e095e4c545c38df74c6bf2a7cfa8aae719d111` | registered, clean, fetched | candidate incomplete | upload/version/share/revoke/sync/conflict/recovery require review | Android/iOS target; Web/desktop companion optional; no accepted install | WA/GW/storage/Trust and L10N incomplete | Cloud/Docs thread: durable storage contract and native offline lifecycle |
| YNX Docs | same Cloud/Docs candidate | registered, clean, fetched | candidate incomplete | edit/collaborate/history/export/AI approval/recovery require review | Android/iOS target; Web/desktop companion optional; no accepted install | WA/GW/AI/storage and L10N incomplete | Cloud/Docs thread: collaboration truth, conflict recovery and install evidence |
| YNX Browser | `codex/ecosystem-browser-search` `7878c79557b30195a2deab87a72ccfa314442875` | registered, clean, fetched | candidate incomplete | navigation/history/download/privacy/permissions/recovery need review | Android/iOS plus macOS/Windows target; no accepted installers | WA/GW/AI/Trust/provider contracts and L10N incomplete | Browser/Search thread: non-shell desktop/mobile browser and provider privacy |
| YNX Search | same Browser/Search candidate | registered, clean, fetched | candidate incomplete | query/result/source/privacy/failure gates require review | Web-first plus Browser integration; not deployed/public | real provider/index contract and L10N incomplete | Browser/Search thread: bounded index truth and unavailable/error behavior |
| YNX Finance | `codex/ecosystem-finance` `06868310ed4f03abe2e84d4f3a69c0a65101cb10` | registered, clean, fetched | candidate incomplete | assets/budget/bills/import/recovery/AI approval need review | Android/iOS target; Web/desktop optional; no accepted install | WA/GW/Pay/live sources and L10N amount/legal semantics incomplete | Finance thread: exact sources and non-bank/non-custody/no-yield boundary |
| YNX Mail | `codex/ecosystem-mail-calendar` `1288cae4999bcf82799c43c820b8974ed469e4ca` | registered, clean, fetched | candidate incomplete | send/draft/attachment/search/delete/offline/recovery/provider gates incomplete | Android/iOS target; desktop companion optional; no accepted install | separate WA/GW identity/provider and L10N incomplete | Mail/Calendar thread: real delivery contract without internet-mail claim |
| YNX Calendar | same Mail/Calendar candidate | registered, clean, fetched | candidate incomplete | event/invite/time-zone/repeat/reminder/conflict/recovery gates incomplete | Android/iOS target; desktop companion optional; no accepted install | separate WA/GW identity/provider and L10N incomplete | Mail/Calendar thread: scheduling/provider contract and time-zone locale proof |

## Aggregate status (2026-07-16)

- Candidate branches received: 15 branches covering 23 product identities.
- Pending rework: 15 original tasks; exact prompts were returned to the original
  branches on 2026-07-16. No duplicate product branches were created.
- Reviewed and accepted for final integration: 0. Wallet Auth is accepted only
  into the integration queue, not as an integrated product.
- Integrated into main: 0 of these 15 ecosystem candidate branches.
- Installable from integrated main: 0.
- Remotely deployed/publicly available from these candidates: 0.
- Production signed/externally accepted: 0.
- Shared 12-language foundation: not implemented on main. Arabic RTL and complete
  product coverage remain unverified for all 23 products.

The next dependency gate is the central Wallet verifier/registry and exact
Gateway contract. Product acceptance then proceeds in dependency order while
chain reliability work continues.
