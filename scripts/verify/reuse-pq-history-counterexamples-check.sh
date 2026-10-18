#!/usr/bin/env bash
set -Eeuo pipefail

# Tiny control-only command fixtures. No real Git object, test, build, node,
# credentials, service or operational evidence is created or modified.
check_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
check_helper="$check_root/scripts/verify/reuse-pq-history-counterexamples.sh"
check_case=$(mktemp -d)
trap 'rm -rf -- "$check_case"' EXIT
mkdir "$check_case/bin"
cat > "$check_case/bin/git" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$YNX_HISTORY_CONTROL_CALLS"
while [[ "${1:-}" == --no-pager || "${1:-}" == -c ]]; do
  if [[ "$1" == -c ]]; then shift 2; else shift; fi
done
case "${1:-}" in
  rev-parse|hash-object)
    case "$*" in
      *internal/ynxbatch/key_material_test.go*) blob=702e39f3516e9d09ab6aab62b1c0bf57e547d182 ;;
      *internal/ynxbatch/key_material.go*) blob=5119c266d58b8f4b596372e982af7179ccdbcea4 ;;
      *) printf '%s\n' "${YNX_HISTORY_CONTROL_HEAD:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"; exit 0 ;;
    esac
    if [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" == material-change || "${YNX_HISTORY_CONTROL_FAILURE:-}" == material-index && "$*" == *' :internal/'* ]]; then
      blob=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    fi
    printf '%s\n' "$blob" ;;
  cat-file) [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != baseline ]] ;;
  merge-base) [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != ancestry ]] ;;
  diff)
    if [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" == git-error ]]; then exit 128; fi
    if [[ "$*" == *7a18c61d7aa05a1041e8e30f15620718fe8647d0* ]]; then
      [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != committed ]]
    elif [[ "$*" == *--cached* ]]; then
      [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != staged ]]
    else
      [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != dirty ]]
    fi ;;
  ls-files)
    [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" != untracked-error ]] || exit 128
    # Generated ignored artifact output exists in normal CI. Only this
    # untracked subtree is exempt; an ignored new core Go file must still fail.
    if [[ "$*" != *':(top,exclude,literal)artifacts'* ]]; then printf 'artifacts/generated-control.json\n'; fi
    if [[ "${YNX_HISTORY_CONTROL_FAILURE:-}" == untracked ]]; then printf 'internal/consensus/new.go\n'; fi ;;
  *) exit 128 ;;
esac
SH
chmod 700 "$check_case/bin/git"
export PATH="$check_case/bin:$PATH"
export GITHUB_EVENT_NAME=push GITHUB_REPOSITORY=JiahaoAlbus/YNX-Chain
export GITHUB_REF=refs/heads/codex/ynx-pq-perf-integration
export GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export YNX_HISTORY_CONTROL_CALLS="$check_case/git-calls"
unset YNX_HISTORY_CONTROL_FAILURE YNX_HISTORY_CONTROL_HEAD

expect_history() {
  local wanted="$1"
  shift
  : > "$YNX_HISTORY_CONTROL_CALLS"
  local result=0
  bash "$check_helper" "$@" > "$check_case/stdout" 2> "$check_case/stderr" || result=$?
  [[ "$result" == "$wanted" ]] || { printf 'history reuse control expected %s, got %s\n' "$wanted" "$result" >&2; exit 1; }
  if [[ "$wanted" == 0 ]]; then
    [[ "$(cat "$check_case/stdout")" == YNX_PQ_HISTORICAL_COUNTEREXAMPLES_REUSED_DATA_ONLY* ]] || exit 1
    [[ "$(cat "$check_case/stdout")" == *runId=39163984700\ runAttempt=1*currentTestExecutionClaimed=false*currentWholeSuitesStillRequired=true* ]] || exit 1
  else
    [[ ! -s "$check_case/stdout" ]] || exit 1
  fi
}
expect_history 0
# All original provider and test sources are covered; only the three approved
# new material leaves are excluded. These are actual production argv bytes.
for check_path in internal/consensus internal/chain internal/ynxauth internal/ynxconsensusauth internal/ynxbatch third_party/cometbft cmd/ynx-comet scripts/ops/rollback-consensus-candidate.sh scripts/ops/validate-private-consensus-copy.py package.json package-lock.json hardhat.config.ts scripts/contracts contracts artifacts; do
  [[ "$(cat "$YNX_HISTORY_CONTROL_CALLS")" == *":(top,literal)$check_path"* ]] || exit 1
done
for check_leaf in key_material.go key_material_test.go README.md; do
  [[ "$(cat "$YNX_HISTORY_CONTROL_CALLS")" == *":(top,exclude,literal)internal/ynxbatch/$check_leaf"* ]] || exit 1
done
[[ "$(cat "$YNX_HISTORY_CONTROL_CALLS")" != *--exclude-standard* ]] || exit 1
# Inspect actual argv lines: generated output is exempt only for ls-files,
# never for tracked/index/working artifact diffs.
while IFS= read -r check_call; do
  if [[ "$check_call" == *'ls-files --others'* ]]; then
    [[ "$check_call" == *':(top,exclude,literal)artifacts'* ]] || exit 1
  elif [[ "$check_call" == *' diff '* ]]; then
    [[ "$check_call" != *':(top,exclude,literal)artifacts'* ]] || exit 1
  fi
done < "$YNX_HISTORY_CONTROL_CALLS"
for check_failure in baseline ancestry committed staged dirty git-error untracked untracked-error material-change material-index; do
  export YNX_HISTORY_CONTROL_FAILURE="$check_failure"
  expect_history 1
done
unset YNX_HISTORY_CONTROL_FAILURE
GITHUB_EVENT_NAME=workflow_dispatch expect_history 1
GITHUB_EVENT_NAME=pull_request expect_history 1
GITHUB_REPOSITORY=attacker/YNX-Chain expect_history 1
GITHUB_REF=refs/heads/codex/ynx-pq-remote-aaaaaaaaa expect_history 1
GITHUB_SHA=0000000000000000000000000000000000000000 expect_history 1
GITHUB_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb expect_history 1
YNX_HISTORY_CONTROL_HEAD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb expect_history 1
expect_history 1 --baseline arbitrary
expect_history 0
printf '%s\n' 'YNX_PQ_HISTORY_REUSE_PURE_CONTROLS_DATA_ONLY realGitEvidence=false nodeStarted=false'
