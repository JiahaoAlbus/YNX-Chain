# YNX Governance & Protocol Control — Current Checkpoint

Status: **Active**
Phase: **FREEZE**
Branch: `codex/final-governance`
Last protected remote checkpoint before this slice: `38711b54e7020dc221708ce07a308ad268313cc5`

## Implemented and verified in this slice

- Runtime-loaded Governance Object Registry with 34 versioned control objects.
- Runtime-loaded Parameter Registry with 32 bounded, rate-limited, timelocked parameters.
- Machine-readable Role Registry with 12 scoped, expiring, revocable roles.
- Dedicated Emergency Council separated from Technical and Security Council authority.
- Dedicated Execution Operator separated from Treasury Council authority.
- Public read APIs for proposals, roles, parameters, emergency actions, appeals, and governance objects.
- Fail-closed restore checks for the legacy combined `token_holder_delegator` role.
- Fail-closed restore checks for legacy Technical/Security Council emergency approvals.
- Registry digest, cross-reference validation, immutable-copy tests, and public API tests.

## Verification

- `go test ./internal/governance ./chain/governance` — passed.
- `go test ./...` — passed.

## Truthful release state

- `implementedLocal`: partial, true for the registry/role/emergency-control slice only.
- `testedLocal`: true for this slice.
- `integratedCentral`: false.
- `deployedStaging`: false.
- `deployedPublic`: false.
- `productionSigned`: false.

## Next engineering target

Expand the runtime proposal lifecycle into the complete canonical state machine, then add signed vote envelopes with proposal/chain/domain/nonce binding, replay rejection, replacement policy, public vote/timelock/execution APIs, and end-to-end Testnet evidence. The long-term Governance goal remains Active.
