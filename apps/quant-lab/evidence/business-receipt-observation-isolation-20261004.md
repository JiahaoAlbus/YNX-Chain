# Quant owned business receipt isolation and actual local recovery

Inherited exact checkpoint: `be229b38367d25aff1523c2760ac3da3b9dc6641`, tree `9e1ac8a6c6514d9a4041eb1297335f7c1e9201b8`. Snapshot isolation is preserved, not redone.

## Actual defect / full owned correction

Seven original Service business paths returned nested references to cached state: Kill, Reconcile, RegisterDataset, RunBacktest, AdvanceStrategy, ConfigureStrategySchedule stop and start. A new original-Service regression failed on all seven against unchanged production source, package 0.490s: changing a business receipt or dataset caller input changed retained service state. This is a Go ownership/serialization defect, not evidence of a remote exploit or an approved live-capital operation.

The correction copies only nested mutable observations: Paper Orders and DailyRisk, strategy Params, dataset use/type/bias/lineage slices on storage ingress, and a completed Experiment through the existing exact research-receipt copier. Existing research normalization already copies incoming Params; it was not duplicated. Immutable scalar fields, exact int64 units, validation, risk gates, save/error handling, stage transitions, scheduler permission, audit, nonce/idempotency, hashing and schemas are retained. No policy, authority, execution adapter or shared SDK changed.

The seven target cases now mutate returned nested records and original dataset input, then assert unchanged original cache hash, byte-identical durable file and exact original record in a newly opened Service instance. All operations use isolated test stores and controlled records; no real account or trading capability is supplied.

## Executed verification

- Focused original-Service seven cases `-race -count=3`: 21/21 subcases PASS, package 1.541s after durable-byte/cold-instance assertions were added. Earlier focused race PASS 1.764s.
- `go test -race ./internal/quantlab -count=1 -timeout=180s`: PASS 4.620s.
- `go vet ./internal/quantlab`, gofmt and `git diff --check`: PASS.
- `node --test apps/quant-lab/tests/tenant-persistence.test.mjs apps/quant-lab/tests/research-recovery-browser.test.mjs`: 2/2 PASS, zero failures/skips, 16486.766417ms.
- Actual local HTTP test: two isolated tenants, two concurrent Go processes, 12 same-key submissions -> exactly two tenant-scoped Paper orders; different-body same-key race -> one additional order and one409; restart/replay preserves original receipts; stale/cross-tenant strategy hashes403.
- Actual local Go plus two independent real Chrome profiles: saved research survives lost return, explicit recovery and four clean SIGTERM stops/restarts; failed/unavailable workspace observations preserve confirmed view and block fresh Paper without resubmitting research. No shared identity/authorization SDK is replaced in production; the research feed is a documented controlled loopback tape.

No PostgreSQL opt-in environment was enabled in this round. Local file/process/controlled-browser results are not PostgreSQL multi-instance, public market, Wallet approval, chain execution or production proof.

## Retained QA evidence identity

Controlled research process evidence root:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-R7x4k1`.

Local QA executable `ynx-quant`: 11467138 bytes, SHA256 `75ff0028dd87c9e3b9ec6f7969d976925c5328695f55f13106307056f337badb`. This is a test executable built by the existing browser fixture, not a formal installer or release candidate.

`workspace-unavailable-en.png`: 208242 bytes, SHA256 `60d29d03efe7f8edc222c9d13c070af1a6f46734d51cf8c5b3de6a76edd0891f`.
`workspace-recovered-en.png`: 191614 bytes, SHA256 `ddfb02ecc53cda3d91b28811bfc4e52bc7c4709c9d2416e892754734caaaf489`.

Screenshots are local controlled Chrome captures, not ComputerControl or public/installed product acceptance. The independent tenant fixture removes its own temporary directory on normal completion; the separate research root is retained as above.

## Integration and remaining real gates

Only ordinary Quant engine/tests/evidence changed. No Finance/Exchange/DEX/Card/Wallet/Shared/Host paths, formal manifest/pins, public service, credentials or current users were modified. No real account approval, signing, EIP712, transaction, external AI/trading request or SSH occurred. Public/source-bound runtime, native installers, canonical private business producer/profile/mount and genuine end-user acceptance remain open; A wallet_release_owner owns the compatible formal build/release path. Historical failures remain intact, not relabeled green.

Route exact source and remaining release dependencies to `接续测试网生态审计工作`. A source rollback is a normal reviewed revert, never reset/force-push or production mutation. Whole Finance-suite goal remains incomplete; this closes the seven reproduced ordinary observation aliases, not every product gate.
