# YNX Pay Current State

- Product: `04` / `YNX Pay`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/04-pay`
- Branch: `codex/final-pay`
- Tested source SHA: `21a2f0412598ef94dd33ff132456c63d5cee6798`
- Remote branch SHA: `21a2f0412598ef94dd33ff132456c63d5cee6798`
- Main SHA at recovery: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind main: `27 / 0`
- Dirty state at recovery checkpoint: clean before this documentation update
- Phase: `INTEGRATE`
- Goal status: `active`

## Latest successful verification

- `go test ./internal/payproduct/... -count=1`
- `go test -race ./internal/payproduct/... -count=1` (non-fatal macOS linker warning only)
- `npm run check` in `apps/pay` (typecheck, 13 unit tests, Android/iOS/Web export, 2 Playwright checks)
- `make pay-api-check`

## GitHub

- Pull request: `#11`, open, mergeable, exact head SHA `21a2f0412598ef94dd33ff132456c63d5cee6798`
- CI: started for PR #11; final result not yet recorded in this checkpoint
- Pay release: none
- Pay GitHub Actions artifact: none found

## Public deployment evidence

- `https://ynxweb4.com/pay` returns HTTP 200 after redirect to `www`, but the returned HTML is the generic site shell with canonical `https://ynxweb4.com/`; this is not Pay-specific SSR/SSG or source-bound deployment evidence.
- `https://pay.ynxweb4.com/health` returns an authoritative JSON health response, but reports build commit `98a18815d4ee`, not the current Pay candidate.
- Therefore the current candidate remains `deployedPublic=false` and `downloadHosted=false`.

## Completed

- Recovered and preserved the existing Pay branch.
- Merged current `origin/main` without discarding parallel product work.
- Resolved only Pay-owned agent-memory conflicts locally and retained central acceptance state from main.
- Re-ran targeted Pay API, race, mobile, Web/PWA and contract verification.
- Pushed the merge commit and verified local SHA equals remote SHA.
- Opened PR #11 to trigger source-bound GitHub Actions.

## Remaining

- Obtain successful CI for the final PR SHA and fix any Pay-owned failures.
- Secure central Wallet/App Gateway and integration-owner acceptance.
- Execute fresh authoritative Testnet invoice, committed payment, sponsorship, refund, dispute and webhook evidence.
- Produce current-source hosted artifacts, SBOM/provenance linkage, install/cold-launch proof and release record.
- Replace the generic `/pay` fallback with a source-bound Pay micro-site through the Website owner.
- Deploy the current Pay runtime and verify its health/version SHA.

## Current risks

- Public runtime SHA differs from the current candidate.
- `/pay` is a generic SPA fallback with root canonical.
- No current-source public artifact or install evidence exists.
- Central dependency acceptance and fresh Testnet evidence are absent.

Updated: `2026-07-29T02:34:00Z`
