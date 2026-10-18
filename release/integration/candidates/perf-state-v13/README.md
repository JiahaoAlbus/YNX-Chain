# Fixed Perf state-v13 integration candidate

This unpublished successor binds only commit `d47b0fb8bf817093d1da0cd0dc8b08725bfae0f7`, with `internal` tree `fc5ccab4e9aa6923bc61a2dc7ac518343ac56703`. Its runtime is committed-state schema **13**, AppHash domain **YNX_ABCI_STATE_V13**, ABCI application **19**.

Run from any directory, using a repository that already contains that Git object:

```sh
node /absolute/path/to/perf-state-v13/check.mjs --repository /absolute/path/to/repository
node --test /absolute/path/to/perf-state-v13/check.test.mjs
```

The checker reads immutable Git objects, verifies the exact commit/internal tree and all 23 SHA-256 source-map entries, then runs the predecessor validator's assertions against the candidate documents and the fixed runtime source. It does not read current working Go files, fetch a branch, compile Go, start a node, publish artifacts, or activate an upgrade. `check.test.mjs` exercises actual positive validation and deliberate source/version/boundary/replay/evidence violations. These are **Node source-contract checks**, not execution of the Go state loader, cryptographic replay, or BFT finality.

The original 71 cross-product vector specifications and all original 107 assertion sites remain. `inherited-profile.mjs` changes their source reader, source binding and explicit schema/app/domain/contract-version expectations; it adds one fixed-source assertion. Five additional candidate boundary specifications are present. Historical nested capability-test flags are inherited claims from the predecessor and are explicitly marked as such in `candidateCompatibility.evidence`; they are not new test results. Candidate `testedLocal`, packaging, signing and deployment flags remain false. Suspended products are not developed, tested, built or activated by this static contract check.

## Three separate source streams

| Stream | Source | State / AppHash | App version | Status here |
| --- | --- | --- | --- | --- |
| Published contract predecessor | `cb20b1591f81328a26ce5c412600135ffb6894bb`, contract `1.12.0` | 12 / V12 | 18 | Three original JSON objects retained byte for byte |
| This Perf candidate | `d47b0fb8bf817093d1da0cd0dc8b08725bfae0f7` | 13 / V13 | 19 | Independent unpublished contract candidate |
| Protocol development | Separate Protocol source | Base 15 / V15; validator registry 16 / V16; engine schedule 17 / V17 | Base 15 | Not substituted into, or made compatible by, this candidate |

The predecessor files are `release/chain-core/product-release.json`, `release/integration/chain-core-contract.json`, and `docs/integration/CHAIN_CORE_CROSS_PRODUCT_TEST_VECTORS.json` in the fixed source. Their original Git bytes are pinned in `source-map.json`. If present in the selected checkout, their bytes must still match. This bundle does not create, replace or modify those paths and does not retarget the existing source-release tag.

## Upgrade and replay boundary

The fixed disk loader's v12 path first validates the original V12 hash (or the exact unchanged migration anchor), changes the state version to 13, initializes the four new DEX collections empty and recalculates the V13 hash when applicable. Existing account and execution history fields are preserved. The fixed source contains the real Go regression `TestCommittedStateMigratesVersion12WithoutInventingDEXRecords`; its presence is checked, but this Node candidate does not run it.

That disk loader compatibility does **not** mean a v12 ABCI state-sync snapshot is accepted by v13: `OfferSnapshot` requires the exact current state version. State-sync restore validates the complete decoded state, metadata, payload hash and externally supplied trusted AppHash before persistence. A coordinated app-version transition and the actual Go replay/recovery gates remain separate. Mixed application-version consensus and arbitrary rollback detection from a rewritten self-sealed snapshot are not claimed; an independent trusted checkpoint is required.

## Files

`product-release.json`, `chain-core-contract.json` and `cross-product-test-vectors.json` are candidate metadata, separate from the originals. `source-map.json` maps every consumed runtime/checker/test source to the fixed commit and exact SHA-256 bytes. `check.mjs` is the executable source/version/boundary validator; `inherited-profile.mjs` preserves the original capability assertions; `check.test.mjs` contains executable positive and negative Node regressions.
