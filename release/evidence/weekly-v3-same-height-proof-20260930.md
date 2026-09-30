# Weekly v3 first-round recovery checkpoint

Request: the current user message explicitly selects the 328-line attachment
`/Users/huangjiahao/Downloads/YNX_Codex_Weekly_v3_Credential_Independent_ZH.md`.
It was read completely, including Goal, Startup Prompt, env template and references.
The filename supplied by the user mentions `(1)`; the actual attached path does not.

## Preservation and reuse

- Base: origin/main `074b6ba1e6efb788a85d09dc260b1e6ed42aa2b3`.
- Branch: `codex/weekly-v3-same-height-proof-20260930` in a new isolated worktree.
- Main checkout remains at `d33a6c790ec26223394810ff48da92b404526136`.
  Six tracked Faucet/deploy/doc changes and its untracked directories were not touched.
- Existing Finance release worktree at `1f8946d4a0c11985c4aa350ddcf1c3181f2492fb`
  retains all nine pending verifier/test/manifest changes; they are not part of this checkpoint.
- Current main already contains Finance Broker adapter, `PROVIDER_INTEGRATION.md`,
  `PROVIDER_ACTIVATION.md`, config schema, doctor, controlled sandbox verifier,
  Wallet approval contracts and network descriptor/generation tools. No duplicate
  Finance application, broker engine, account system or fixture service was created.
- No genesis, chain configuration, balances, contracts, keys or service state changed.

## Actual change and local checks

Network comparison previously could mark `readOnlyComparisonVerified=true` after
balance/nonce reads fell back to latest, if transaction and contract samples existed.
The result now separately reports `sameHeightStateVerified`; latest-only fallback
keeps aggregate comparison false and adds `SAME_HEIGHT_STATE_UNSUPPORTED`.
Latest samples remain available as diagnostics. No automatic migration is enabled.

Commands executed in this checkpoint worktree:

```
node --test scripts/verify/testnet-endpoint-migration-check.test.mjs sdk/js/testnet-endpoints.test.mjs
node scripts/ops/generate-testnet-endpoints.mjs --check
git diff --check
node scripts/verify/testnet-endpoint-migration-check.mjs --live
```

Local regression: 41/41 passed, zero failed/skipped. Generated configuration matches.
New negative regression covers latest-only balance and nonce even with valid historical
transaction and nonempty contract proofs. Mainnet rejection and old-consumer checks remain.

## Public read-only evidence

The live command completed with exit 2 (incomplete proof, not acceptance).
Old/new RPC identity matched `0x1917` / `6423` and block height 1761700 matched hash
`0x5a0a9a0b22c407a9b177a0b4938a5cc271ec0dc044817fb3f8fd5e8100f9c8fa`.
Faucet aliases reported build `4045579f1e27ccab67538bd2dbc4c656323a4c0b`.
Balance, nonce and code at fixed historical height were unsupported and explicitly
sampled at latest. `sameHeightStateVerified=false`, `readOnlyComparisonVerified=false`,
`publicVerified=false`. No Faucet claim, order, account creation or chain transaction was sent.

Remaining gates: fixed-height state capability; historical transaction/nonempty-contract
samples; Explorer alias; growth/native REST/CORS; required transports; shared Faucet state;
Wallet/ecosystem regression. This sample does not verify all these gates.

## Independent truth and next handoff

For this gate patch only: implemented=true, contractTested=true,
officialSandboxVerified=false, publicDeployed=false, publicVerified=false,
productionApproved=false. These are not whole-week completion flags.
Official Broker authentication/entitlements/writes remain BLOCKED_CREDENTIALS / NOT_VERIFIED.
Only secure configuration location/reference and explicit test-write approval should be
requested later; no plaintext secrets are requested in chat.

Integration was notified of the current user scope. It reported a conflicting active
Connection Only scope. No extra writer was started; Finance owner was asked for a
read-only checkpoint/gap inventory only. Shared writing and release are held pending
scope/owner resolution, without deleting either set of work or stopping services.
Next work is reconcile the two explicit scopes with Integration, reuse existing Finance
v3 gap inventory, and give Finance/Wallet an exclusive bounded handoff rather than wake
their old ecosystem goals.

Recovery: use this branch/commit or its Git bundle. This is verifier-only and has no
deployment rollback requirement; reverting its commit restores the previous gate.
Do not apply the preserved Finance dirty patch over another owner's active worktree.
