#!/usr/bin/env bash
set -Eeuo pipefail

# Reuse only historical RED/fixed evidence from the approved normal push below.
# This is not a current test execution or a waiver for current whole suites.
# In particular, do not skip the NodeOwnedDatabase/Indexer/ProofSourceConsumer
# fixed group: no separate current whole-suite call presently covers it.
history_baseline=7a18c61d7aa05a1041e8e30f15620718fe8647d0
history_run=39163984700

history_no_reuse() {
  printf 'YNX_PQ_HISTORY_REUSE_UNAVAILABLE: %s; execute the original counterexample step\n' "$1" >&2
  exit 1
}

history_git() {
  GIT_OPTIONAL_LOCKS=0 git --no-pager -c core.fsmonitor=false -c core.untrackedCache=false "$@"
}

[[ "$#" == 0 ]] || history_no_reuse 'unexpected arguments'
[[ "${GITHUB_EVENT_NAME:-}" == push ]] || history_no_reuse 'normal push required'
[[ "${GITHUB_REPOSITORY:-}" == JiahaoAlbus/YNX-Chain ]] || history_no_reuse 'original repository required'
case "${GITHUB_REF:-}" in
  refs/heads/codex/ynx-pq-public-upgrade|refs/heads/codex/ynx-pq-perf-integration) ;;
  *) history_no_reuse 'original normal push branch required' ;;
esac
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ && "$GITHUB_SHA" != 0000000000000000000000000000000000000000 ]] || history_no_reuse 'exact source SHA required'
history_head=$(history_git rev-parse --verify 'HEAD^{commit}') || history_no_reuse 'Git HEAD unavailable'
[[ "$history_head" == "$GITHUB_SHA" ]] || history_no_reuse 'checkout differs from current push'
history_git cat-file -e "$history_baseline^{commit}" || history_no_reuse 'approved baseline unavailable'
history_git merge-base --is-ancestor "$history_baseline" HEAD || history_no_reuse 'approved baseline is not an ancestor'

# Exclude only the exact new material source approved at fd8b8dcf, not future
# edits to that file (which could otherwise introduce init/provider effects).
# These are Git blob identities of the source bytes, never signing authority.
for history_material in key_material.go key_material_test.go; do
  case "$history_material" in
    key_material.go) history_material_blob=5119c266d58b8f4b596372e982af7179ccdbcea4 ;;
    key_material_test.go) history_material_blob=702e39f3516e9d09ab6aab62b1c0bf57e547d182 ;;
  esac
  history_material_path="internal/ynxbatch/$history_material"
  history_material_head=$(history_git rev-parse --verify "HEAD:$history_material_path") || history_no_reuse 'approved material source unavailable'
  history_material_index=$(history_git rev-parse --verify ":$history_material_path") || history_no_reuse 'approved material index unavailable'
  history_material_live=$(history_git hash-object --no-filters -- "$history_material_path") || history_no_reuse 'approved material working source unavailable'
  [[ "$history_material_head" == "$history_material_blob" && "$history_material_index" == "$history_material_blob" && "$history_material_live" == "$history_material_blob" ]] || history_no_reuse 'the only approved new material exclusion changed'
done

# Include original production code, every existing test/shared fixture in these
# packages, their first-party dependencies and actual external caller materials.
# The three exclusions are the newly added key-material API/test and its README;
# the old counterexamples never call that API. All original provider code stays
# covered. New Gateway HTTP fixture output does not enter these old packages.
history_paths=(
  ':(top,literal)internal/consensus'
  ':(top,literal)internal/chain'
  ':(top,literal)internal/ynxauth'
  ':(top,literal)internal/ynxconsensusauth'
  ':(top,literal)internal/ynxbatch'
  ':(top,literal)internal/accountaddress'
  ':(top,literal)internal/assetauth'
  ':(top,literal)internal/ethnative'
  ':(top,literal)third_party/cometbft'
  ':(top,literal)cmd/ynx-comet'
  ':(top,literal)go.mod'
  ':(top,literal)go.sum'
  ':(top,literal)go.work'
  ':(top,literal)go.work.sum'
  ':(top,literal).gitattributes'
  ':(top,literal).gitmodules'
  ':(top,literal)package.json'
  ':(top,literal)package-lock.json'
  ':(top,literal)hardhat.config.ts'
  ':(top,literal)scripts/contracts'
  ':(top,literal)contracts'
  ':(top,literal)artifacts'
  ':(top,literal)scripts/fixtures'
  ':(top,literal)scripts/ops/rollback-consensus-candidate.sh'
  ':(top,literal)scripts/ops/lib.sh'
  ':(top,literal)scripts/deploy/lib.sh'
  ':(top,literal)scripts/ops/validate-private-consensus-copy.py'
  ':(top,literal)scripts/ops/test_validate_private_consensus_copy.py'
  ':(top,literal)scripts/loadtest/pq-paired-linux-window.py'
  ':(top,exclude,literal)internal/ynxbatch/key_material.go'
  ':(top,exclude,literal)internal/ynxbatch/key_material_test.go'
  ':(top,exclude,literal)internal/ynxbatch/README.md'
)
history_git diff --no-ext-diff --no-textconv --quiet "$history_baseline" -- "${history_paths[@]}" || history_no_reuse 'related source or tests differ from the approved baseline'
history_git diff --no-ext-diff --no-textconv --cached --quiet HEAD -- "${history_paths[@]}" || history_no_reuse 'related index differs from current HEAD'
history_git diff --no-ext-diff --no-textconv --quiet -- "${history_paths[@]}" || history_no_reuse 'related working source differs from its index'
# Include ignored untracked source too: an ignored Go file can still compile.
# artifacts/ is generated by the normal current fixture step and is globally
# ignored. Its tracked bytes stay covered above, while its generator inputs
# are pinned separately. This helper does not verify generated output; current
# fixture generation and complete core/cmd/Gateway tests remain mandatory.
# Git's quoted output keeps newline-only names nonempty without eval/parsing.
history_untracked_paths=("${history_paths[@]}" ':(top,exclude,literal)artifacts')
history_untracked=$(history_git -c core.quotePath=true ls-files --others -- "${history_untracked_paths[@]}") || history_no_reuse 'Git untracked-source check failed'
[[ -z "$history_untracked" ]] || history_no_reuse 'new related working source exists'

printf '%s\n' "YNX_PQ_HISTORICAL_COUNTEREXAMPLES_REUSED_DATA_ONLY baselineCommit=$history_baseline source=https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/$history_run/attempts/1 runId=$history_run runAttempt=1 workflow=.github/workflows/resource-market-ci.yml currentCommit=$history_head historicalREDAndFixedEvidenceReused=true currentTestExecutionClaimed=false generatedFixturesVerifiedByHelper=false currentWholeSuitesStillRequired=true nodeStarted=false"
