# DECISION LOG

Updated: 2026-07-29T02:42:52Z

## 2026-07-29 — Product identity recovery

- Accepted Fable5 Product 31 because MCP `YNX_31`, worktree `31-governance`, branch `codex/final-governance`, and remote `JiahaoAlbus/YNX-Chain` matched exactly.
- Rejected `.ai-bridge/current-plan.md` as recovery authority because it names Product 18 and a different worktree.

## 2026-07-29 — CI portability repair

- Root cause: Playwright always launched `/Applications/Google Chrome.app/...`, causing Linux Actions to fail.
- Decision: use `YNX_GOVERNANCE_BROWSER_EXECUTABLE` when explicitly configured, use installed Google Chrome on macOS when present, and otherwise use Playwright-managed Chromium.
- Decision: install Playwright Chromium explicitly in the Governance Actions workflow.
- Result: local browser gate passed and Actions run `30416918267` succeeded on `4e6c67488e81f5ec82995de81dd25a33861d7dc3`.

## 2026-07-29 — Central main reconciliation

- `origin/main` contained PR #9 plus central governance-preflight integration that the product branch lacked.
- Decision: merge `origin/main` into the product branch rather than rebase/reset, preserving all concurrent history.
- One conflict existed in `scripts/verify/governance-check.sh`.
- Resolution: retain governance browser verification and timeout/offline npm-audit fallback while accepting the central Makefile and preflight wiring.
- Result: post-merge local governance verification passed.

## 2026-07-29 — Release truth boundary

- Existing prerelease `governance-v0.3.0-integration.1` remains a valid historical integration candidate tied to `340e6a8a3eecd973145677bde0879a918e3924ed`.
- It must not be promoted as the current branch release because later UI, gRPC, evidence, CI-portability, and preflight commits are not included.
- No new release will be published until the exact accepted candidate SHA has successful CI, central integration acceptance, refreshed artifacts, SBOM, provenance, and release records.

## 2026-07-29 — Concurrent local Testnet process

- A local governance Testnet drill occupied port `31656` and originated from another active MCP execution in the same worktree.
- Decision: preserve it and do not terminate it, because ownership of the active process could not be safely attributed to this execution.
