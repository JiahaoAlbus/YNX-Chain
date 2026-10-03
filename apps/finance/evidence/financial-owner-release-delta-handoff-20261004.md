# Financial product source integration handoff

This is an ordinary owner-source handoff, not a formal release bundle, deployment authorization or replacement for A's compatibility manifest.

## Exact input

Owner branch: codex/exchange-sso-cookie-binding-20261002.
Reviewed input commit: 211060d1f3b36c8fb9fc8fbc2aa385f02adf61d7.
Input tree: c6c4db522313c8169337b9dcffbbbb66ef3689ca.
Delta base: 77bcf13b2543733ec6d5efcecb4065a47da5ea78 (not claimed as current public source).
Delta: 32 files, 1706 insertions, 31 deletions, limited to owned Finance/Exchange/Quant products and direct tests/evidence. Do not merge the entire branch into a shared release checkout without resolving its existing authority graph.

## Changed runtime source identities

| Path | Git blob | SHA256 |
| --- | --- | --- |
| apps/finance/web/app.js | ed72056eca88485fcd75ab4030d3dbe5780dfb05 | e400af3c6994aba7fd6603a9f2e19ec7ff6b04a2fb137a0877f5c9520b759b33 |
| apps/exchange/web/app.js | fa87aa1fc32a4ce270b414f83a6e8c4baf1cee28 | 92daf8cb17675886b84722672a156ce3051a7334d66df5e95e28945890f0067e |
| apps/exchange/web/private-account-controller.js | 723360637e62fef41e69778c767fec3db722b778 | bf67b1b01c847980774f2d929578be6c64dd04e24f607d69a576ace841912ce1 |
| apps/quant-lab/web/app.js | f5fc3d8e05a02479e4e1e0de92f7e598e1798dce | 04f3b7b02f1c26b44d9c4ddb147811149e93892f55913a11f2293f16fc7a4a80 |
| internal/quantlab/service.go | 926381a58745170103c66be2b694446e4eaca931 | 933ff6f07b96432ea4e6b90ec9d32e809a2e13349ca69ff798a690a006086116 |

## Product effects and evidence

- Finance 0b4d4166: confirmed saves remain confirmed after follow-up read failure; statements reject invalid calendar aliases. See owned-save-statement-recovery-20261004.md.
- Exchange 22efb60a and b4191473: exact identity-encoded account response framing; current order rendering and retired local cancellation intent bound to selected account. Compressed response semantics unchanged. Backend API already rejects foreign snapshots; controlled renderer test is not a demonstrated public leak. See Exchange account-response/open-order evidence.
- Quant 38e8afa4, 16109eaa, 95644194, 211060d1: unconfirmed risk fences fresh Paper; persisted kill rejects fresh Paper before market lookup while exact replay remains readable; confirmed schedule survives history outage; rewritten research pending envelopes fail closed. Only engine delta is the six-line persisted-kill guard. No new execution rights or market data fabricated.
- Real isolated PostgreSQL OS-process tests cover Paper, schedule SIGKILL recovery, research concurrency/replay/restart and Exchange multi-match conservation. Local controlled history and tenant bindings are not authenticated public users or prices. Browser tests use installed Chrome headlessly, not ComputerControl.

No new API/event/error protocol, database schema migration, Wallet scope, permission, endpoint, shared SDK or production configuration was introduced. Existing stores and replay contracts are reused. The PostgreSQL QA cluster is retained and stopped; owned test rows were removed, not production data.

## Fresh complete Finance journey batch

Seven direct groups (owned-save controller/browser, owned-read, owned-AI, product-response recovery, overview-source browser, planning-source browser) were run together. First run: 54 PASS, 1 cancelled export-browser test at 20s. Its unchanged isolated rerun passed in 1570.879625ms; therefore the cause is not established as a production defect and the failure is retained here.

The export fixture now uses real browser button clicks rather than page-evaluated programmatic clicks. Complete rerun: 55/55 PASS, 40860.549542ms, covering save/unknown exact retry, fresh read, statement period/owner, export coalescing/old-account suppression, privacy edits, account draft retirement/restore and AI job/action retirement. The export test was further strengthened to read the actual downloaded file and require exact JSON content, not only an event or filename; focused final version PASS, 1198.237708ms. No download business-code change was needed or claimed. Syntax/diff checks pass. These remain controlled local product journeys, not live authenticated Finance or native installation proof.

## Required integration closure (A / release owner)

1. Consume these ordinary product deltas in the existing complete compatible source graph; preserve A's Finance authority and shared Wallet/Auth/SSO/API implementations and formal artifact pins. Source identity below must not be confused with deployed version.
2. Freeze/build/publish the complete compatible runtime and installers using A's existing authority and rollback process. Update public source/version and asset identity as one compatible release, not frontend-only overlay on an old backend.
3. Resolve the already reported Exchange write-producer/capability mapping: current account read scope does not authorize cancel/order/deposit/withdraw writes. Do not widen read permission or remove product guards; supply the existing accepted producer and precise action contract.
4. After actual release provide exact URLs, runtime/source/artifact hashes, install identities and rollback. The product owner then exercises the normal public/installed journey. Account approval/sign/EIP712/order/transaction actions remain immediate-user-confirmation steps, not implied by these tests.

Public/current-source, native install, canonical Product Session v2, real Wallet approval and actual financial operation remain unverified. Earlier failed remote release state remains UNKNOWN; this handoff does not authorize a network/credential retry, remote cleanup or bypass of any rejected review. DEX/Card/Pay/shared/Host paths are outside this owner update. No SSH or production writes occurred.
