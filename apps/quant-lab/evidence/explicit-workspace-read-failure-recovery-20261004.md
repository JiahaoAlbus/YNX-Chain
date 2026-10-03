# Explicit workspace read failure recovery

Inherited clean owner checkpoint: 1fb7c0835913f1e6e9cda26e50ee5ef3c88a4e8a / tree e9082a37fa25d1131fef8528f8da7ecdc5cae4cf. This is an ordinary Quant UI/recovery successor. No engine, shared authorization, formal asset pins or production runtime change.

## Reproduced failures and corrections

The existing Go snapshot contract can return HTTP 200 with cached state, a non-null `failure` and sourceMetadata status `unavailable` after an authoritative durable read fails. The UI previously accepted that response as a successful refresh. The red regression replaced the last confirmed cash 777 / KillSwitch=true with unconfirmed cash 999 / KillSwitch=false (19.904125ms). Refresh now rejects explicit failure or unavailable source before assigning snapshot or reconciling an unknown risk outcome. The prior confirmed data stays visible with a persistent unavailable warning; fresh Paper intent remains blocked. This does not replace the authority contract or claim a current read from cached state.

A separate real Chrome enlarged-text regression found `research-held-out` overflow at desktop 200% text: page width 1450 versus viewport 1440. Inspector definition rows now wrap, use bounded shrinkable children and remove the implicit definition margin. The original text and financial values are preserved. This is not hiding or deleting the explanation.

The existing direct two-tenant HTTP fixture omitted strategy name from its submitted-request consistency envelope, though the production matching fence already requires name. The test now binds the actual original request name; production matching is unchanged. Earlier failed runs are not counted as passes.

## Executed final tests

Four ordinary groups: business-flow, tenant-persistence, research-recovery-browser and financial-brand-browser. Final result 106/106 PASS, 0 fail, 0 skip, 12316.227708ms. Extended failure-before-confirmation focused test also PASS: transport failure, explicit failure and unavailable-source HTTP bodies, twelve locales, zero confirmations and zero POSTs. JS syntax and diff gates PASS.

Actual unchanged local Go engine + two real Chrome profiles covers two explicit failed-read HTTP 200 responses built from the actual local service response, twelve selected languages, byte-unchanged prior snapshot, KillSwitch=false retained as false, disabled fresh Paper control, explicit verified recovery, no research resubmission, independent saved research, lost-return replay and four complete SIGTERM/restart cycles. Independent local HTTP fixture exercises two tenants, two concurrent processes, twelve same-key Paper requests, changed-intent race and restart recovery. These tests use controlled local prices and local preview tenant capabilities, not real Wallet identity, public trading or PostgreSQL proof.

Final Go/Chrome QA root: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-iS2r5m`.

- Unchanged QA binary: 11467138 bytes, SHA256 d342ef34c43da678ae5202dea0d5a2801448821b684e539cf27af0cded36f2e8.
- workspace-unavailable-en.png: 208242 bytes, SHA256 60d29d03efe7f8edc222c9d13c070af1a6f46734d51cf8c5b3de6a76edd0891f.
- workspace-recovered-en.png: 191602 bytes, SHA256 ad67ee8e1882b3719444090e261d6a213c9f03e881d6c95c115f4dfa8507345c.

Brand/layout regression covers desktop/mobile guest/business views and enlarged Chinese/RTL document presentation. Two retained images were visually inspected (controlled display, not native ComputerControl): `tmp/financial-sizing-evidence/quant-lab-1440-zh-CN-enlarged.png` SHA256 4436c03f25906c1422711610b75d03439a87224c134ec145ff6238baabe1100f; `quant-lab-390-ar-enlarged.png` SHA256 e0dae64a2902129f62b681ec403dede9cbab3fca31c2177bf71e2f96013e430a. Those document-language sizing fixtures do not prove all application text was translated; actual twelve-language business controls are separately exercised above.

## Open publication gates

Read-only formal binding checks remain red: combined quant-v2/financial-ordinary-inputs-v2 result 16 PASS / 2 FAIL, specifically `working bytes` and `QUANT_ASSET_HASH_MISMATCH:styles.css`. Their accepted immutable source set and final HTML asset bindings were deliberately not rewritten by this product owner. A must admit the complete compatible owner-source successor and regenerate formal bindings as part of the actual release, not waive the failures.

Public source-bound deployment, real Wallet/account approval, Product Session v2 business writes, installations and public capital execution remain unproved. No account, signature, testnet send, SSH, production lifecycle or formal installer action was taken. Report exact successor and these remaining gates to `接续测试网生态审计工作`; keep the full Finance/Exchange/Quant goal active and preserve inherited red evidence.
