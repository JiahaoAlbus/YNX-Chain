# Weekly v3 credential-independent acceptance audit

Date: 2026-09-19. Authority: the complete 328-line attachment
`YNX_Codex_Weekly_v3_Credential_Independent_ZH.md`, including its goals and startup
prompt. The env appendix is a requested template, not pre-existing support.
Sole coordinator: task `01a094cc-0ba3-7901-bcd5-56fce8330c0d`. This is NETWORK's
assigned cross-product acceptance report, not an independent deployment approval.

## Exact evidence and recovery points

- Finance final: `0adc35cd722d8728fc41704350c5f7a0056200d8`, tree
  `821d1661d2818f4347a59800d8e0764410b659b2`; implementation
  `1329c6a03c8bcd4b02baed1ea8e68f0019d26dd9`. Owner tree clean and remote exact.
- Wallet: `bd977cd2d382c4c43a435c8e415e698205b8a102`; unrelated existing
  `apps/wallet-web/artifact-manifest.json` dirty file preserved, not included.
- NETWORK acceptance source: `9e83f71f2d04e7252b8748655df5954dcee529b5`, tree
  `1d05f75169282514d21cfe4d2e7439def2116a4a`. All 15 exercised source hashes match.
- Corrected full report:
  `release/evidence/weekly-v3-cross-product-0adc35cd-expanded-corrected-20260919.json`:
  **33 root groups / 104 leaf cases PASS**, Go race, stable products/assets.
- Initial report with fixture-prerequisite failures is retained under
  `weekly-v3-cross-product-0adc35cd-expanded-initial-20260919.json`; historical
  81-case acceptance and earlier genuine product failures are not overwritten.
- NETWORK/Wallet regression report:
  `release/evidence/weekly-v3-network-wallet-0adc35cd-final-20260919.json`.

## Requirement-by-requirement assessment

“Local” below means isolated contract/runtime testing with synthetic identity,
Gateway content and TLS-pinned provider responses. It never means real provider
credentials, installed Wallet approval or public release acceptance.

| Attachment requirement | Authoritative implementation/evidence | Assessment and remaining boundary |
| --- | --- | --- |
| 1. Only existing Finance/Wallet increment and Testnet endpoint work; no new stock app/L2/Quant/backend proliferation | Exact owner worktrees and shared `WEEKLY_V3_HANDOFF.md`; Finance module and one Alpaca adapter | Implemented in scoped owners; other products/services not restarted or rewritten |
| 2. Protect dirty work, baseline, branches, rollback and chain/user state | Published checkpoints, pre/post owner guards, historical failure reports, state v1→v2 migration and regression tests | Existing main checkout/Wallet artifact preserved; no reset/clean/force push/data reset |
| 2. Independent feature flags and old Finance/Wallet functions | `.env.example`, config schema/loaders; Finance npm 65; Wallet 20/67/143; default-closed native execution test | Local pass; installed/public runtime remains independently unverified |
| 3. Actual Alpaca Broker API Sandbox, not personal Paper; capability/account/assets/quote/order/positions/cash/event/reconcile boundary | Finance `PROVIDER_INTEGRATION.md`, `internal/finance/brokerage`; complete pinned public wire fixtures; actual adapter loopback tests | Implemented and local-tested. Client credentials and explicitly provisioned legacy Basic supported; private-key JWT explicitly unsupported |
| 3. Provider IDs, raw status and request ID audit | Order/outbox/journal fields; submit/refusal/poll/event/reopen assertions | Local pass; HTTP request ID, local Wallet request ID and event cursor kept distinct; no fabricated HTTP ID on lost ACK |
| 4. Existing navigation, environment banner, owner account/status, search/watchlist, quote source/time | Actual source and Finance HTTP + native/VM browser suites | Local pass. Missing configuration/entitlement remains unavailable, never fake balances/assets |
| 4. Manual order and AI draft; limit buy, owned-position sell, cancel, state/cash/position/fees/error/recovery | Actual Wallet controller/HTTP/store/adapter flow, preflight, sell availability, partial fill/cancel race, lost ACK and restart tests | Local pass for bounded operator-controlled single-order workflow; not an automatic public trading service |
| 4. Existing Gateway, strict schema/deterministic rules, manual fallback, no AI execution | Real Gateway HTTP/SSE client + synthetic remote content; strict negative result cases; native start→job→persist→copy; empty history/Explorer503; opt-out rejection | Local pass. Real model generation is NOT verified; user's global AI privacy opt-out remains enforced |
| 4/7. Missing credentials must not crash original products or silently substitute fake provider | Guest/default-off/invalid-configuration cases, no-write browser gate, provider failure contract | Local pass; synthetic fixtures exist only in isolated acceptance tools |
| 5. Order-specific Wallet display/binding, trusted identity/proof, exact amounts, nonce/hash/expiry, rejection/revoke/replay | Frozen approval contract and actual Wallet controller/crypto + Finance validation/CAS tests | Local pass. Installed/native GUI approval and real authority transport remain separate runtime gates |
| 5. One approval per logical order; changed terms reapprove; expired approval cannot redispatch | Callback/CAS/replay tests; explicit execution HTTP gate + reopen + single provider POST; expired-known-state protections | Local pass; approval alone cannot dispatch, and decline/default-off native UI does not queue |
| 5/6. Cancel is not canceled until provider confirms; no blind retry/shorting/leverage | Actual adapter cancellation/query/reconcile, partial-fill race, lost cancellation ACK, cash and owned-quantity preflight | Local pass. No real securities or chain transaction is performed |
| 6. Owner/provider/environment mappings, exact money, separate YNXT and simulated USD/shares | Persistent mapped-account resolver, wrong-owner/field-injection tests, precision wire fixtures, safety flags and cash-vs-margin tests | Local pass. Actual per-user provider approval/funding is external |
| 6. Event/unknown/restart reliability and bounded rate/pressure tests | 501-order pagination, independent polling checkpoint/event cursor, same-time different orders, duplicates/tenant fences/rejected terminal persistence; rate gates | Local pass. Polling/worker is implemented; authenticated real SSE transport remains unverified, not claimed |
| 7. `.env.example`, configuration schema, safe load/restart, `PROVIDER_ACTIVATION.md`, minimal operator inputs | Named Finance artifacts and their consistency regression; no secret values in artifacts | Implemented/local-tested. Restart through authorized service owner; no automatic hot reload/live activation |
| 7. `finance:doctor`, `finance:sandbox:verify`, controlled one-shot activation | Real command-package tests for configuration/read-only account/assets/quote/orders/positions and `verify-approved`; missing receipt/permission/approval negatives | Local pass. Read-only commands never imply official or public enablement; worker write needs exact explicit receipt/confirmation |
| 7. Durable backend consistency | Actual file CAS/reopen and worker/server backend-selection fences; PostgreSQL schema/CAS code | File path tested. Successful PostgreSQL instance test SKIPPED: no `YNX_FINANCE_TEST_DATABASE_URL`; no multi-host/DB runtime claim |
| 8. Chain6423/0x1917/YNXT preserved, disabled Mainnet reservation, old endpoints retained | Typed canonical migration config/generated consumers/SDK/ChainList rejection tests | Local pass; no genesis/consensus/history/balance/contract mutation |
| 8. RPC/Faucet aliases, CORS, required typed REST/EVM/WS/gRPC consumers, Faucet shared backend/quota | Alias deployment templates, inventory/runbook, generated compatibility configs; endpoint 38; Faucet race/shared-alias/multi-user tests; SDK consumers | Config/local pass. DNS/TLS/ingress deployment authority missing; new aliases not promoted into active consumer defaults |
| 8. Same-height public block/hash/history/code/state, growth, old RPC/Faucet/Explorer and ecosystem regression | Bounded read-only comparison tool + adversarial tests; prior live reads of legacy endpoints; migration runbook | Public alias proof NOT complete. No HTTP redirect or blanket URL replacement used; required samples and deployment authority still needed |
| 8. Third-party chain lists, Explorer alias and old links/indexes | Inventory/external-input sections; current chain metadata preserved | Upstream listing/alias changes not performed without ownership; existing history links retained |
| 9. Necessary threads only, max two writers, sole ownership, exact handoff | Existing Finance/Wallet/NETWORK tasks and one coordinator; shared handoff | Respected; no broad historical ecosystem wakeup, substitute owner or subagent |
| 10. Independent six statuses, negative tests, exact commits/push/rollback/deliverables | Reports, commands, source hashes, remote SHA checks and this audit | Local pass is separately recorded; external gates remain false. Sole coordinator owns aggregate Stage A sign-off |
| 11. Mainnet/live/real funds/real onboarding/chain-native stock claims prohibited | Fail-closed config and negative tests; no live action executed | Preserved. No Rain/Immersve/Card dependency introduced |
| Startup prompt 1–8 | Baseline/protection, minimal frozen contracts, scoped owners, actual implementation, local continuous flow, config/doctor/verify, migration gates, published recovery checkpoints | Assigned local acceptance delivered; unsupported external results not substituted with fixtures |

## Exact remaining inputs / unverified runtime work

1. Secure server-side reference/location for genuinely provisioned Alpaca Broker
   Sandbox credentials and auth mode; actual per-user account mappings, permissions,
   data entitlement and simulated funding. Do not send plaintext secrets in chat.
2. A separate explicit, bounded one-order/one-cancel Sandbox authorization and
   activation receipt after read-only doctor succeeds. Actual official account,
   price, order, fill/cancel and reconciliation evidence is still NOT VERIFIED.
3. Authorized Finance/Wallet installed/public deployment and real authority/model
   runtime testing. Local browser fixtures do not establish these results.
4. DNS/TLS/ingress authority for the new aliases, controlled service identities
   and representative history/contract/state samples. Activate parallel aliases,
   verify same-chain proof and actual shared Faucet state, then migrate consumers.
5. If deploying PostgreSQL, an isolated approved test database and database-native
   backup/restore verification; the existing file backup CLI intentionally rejects
   database-backed mode. This is not needed to claim the tested file-CAS path.
6. Any third-party chain-list publication and real provider SSE activation require
   their own owner permission/evidence. Neither is silently marked completed.

No additional credential-independent defect was observed in the assigned
B1–B4/audit-field acceptance after the corrected 104-case run. This statement
is bounded by the scope above, not a proof that every future provider edge case
or installed/public environment has been exercised. `officialSandboxVerified`,
`realModelGenerationVerified`, `crossProductE2EVerified`, `publicDeployed`,
`publicVerified` and `productionApproved` remain false.

## Recovery and release handoff

Inspect/recover published checkpoints in separate worktrees; never reset the
owner's current checkout. These acceptance changes need no chain-state rollback.
Keep the old RPC/Faucet defaults active. Alias rollback restores backed-up ingress
and DNS without deleting chain/index/admission state. Finance rollback disables
new module/write/live flags and restarts only through the service owner; preserve
v2 data and use a reviewed backup before any older binary is considered.

After publishing this final evidence, NETWORK releases its writer slot. Further
product edits or deployment require the sole coordinator's next explicit scope.
