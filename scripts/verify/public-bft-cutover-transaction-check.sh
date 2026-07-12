#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops" "$repo/scripts/verify"
cp scripts/ops/public-bft-cutover-transaction.sh "$repo/scripts/ops/"
cp scripts/verify/validate-public-bft-cutover-approval.mjs "$repo/scripts/verify/"
git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'cutover fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
baseline="$tmp/baseline"
state="$tmp/state"
printf '%s\n' \
  'ingress=authoritative' \
  'authoritative=running' \
  'frozen=false' \
  'candidate=absent' \
  'dependencies=authoritative' >"$baseline"

future="$(date -u -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
cat >"$tmp/approval.json" <<EOF
{"schemaVersion":1,"action":"ynx-public-bft-cutover","approvalId":"self-test-${commit}","approver":"local self test","approved":true,"commit":"${commit}","release":"${release}","publicCutoverAuthorized":true,"automaticRollbackRequired":true,"expiresAt":"${future}"}
EOF
chmod 600 "$tmp/approval.json"

cat >"$tmp/driver" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
phase="$1"
state="${CUTOVER_TEST_STATE:?}"
failure_marker="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-injected"
set_value() {
  local key="$1" value="$2" next="${state}.next"
  awk -F= -v key="$key" -v value="$value" 'BEGIN { OFS="=" } $1 == key { $2=value } { print }' "$state" >"$next"
  mv "$next" "$state"
}
if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "$phase" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  exit 72
fi
case "$phase" in
  preflight) cmp "$state" "${CUTOVER_TEST_BASELINE:?}" >/dev/null ;;
  backup) cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/state.backup" ;;
  freeze_mutations) set_value frozen true ;;
  pause_authoritative) set_value authoritative paused ;;
  export_final_snapshot) grep -Fxq 'frozen=true' "$state" && grep -Fxq 'authoritative=paused' "$state" ;;
  deploy_candidate) set_value candidate running ;;
  verify_candidate) grep -Fxq 'candidate=running' "$state" ;;
  start_dependencies) set_value dependencies bft ;;
  verify_continuity) grep -Fxq 'dependencies=bft' "$state" ;;
  switch_ingress) set_value ingress bft ;;
  verify_public) grep -Fxq 'ingress=bft' "$state" && grep -Fxq 'candidate=running' "$state" ;;
  unfreeze_mutations) set_value frozen false ;;
  rollback_ingress) set_value ingress authoritative ;;
  rollback_dependencies) set_value dependencies authoritative ;;
  rollback_candidate) set_value candidate absent ;;
  resume_authoritative) set_value authoritative running ;;
  verify_rollback) cmp "$state" "${CUTOVER_TEST_BASELINE:?}" >/dev/null ;;
  *) echo "unexpected cutover driver phase: $phase" >&2; exit 64 ;;
esac
if [[ "${CUTOVER_TEST_FAIL_PHASE:-}" == "${phase}:after" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  exit 73
fi
EOF
chmod 700 "$tmp/driver"

run_transaction() {
  local id="$1" fail_phase="${2:-}"
  (cd "$repo" && PUBLIC_BFT_CUTOVER_MODE=execute \
  PUBLIC_BFT_CUTOVER_APPROVED=yes \
  PUBLIC_BFT_CUTOVER_APPROVAL_FILE="$tmp/approval.json" \
  PUBLIC_BFT_CUTOVER_DRIVER="$tmp/driver" \
  PUBLIC_BFT_CUTOVER_EVIDENCE_DIR="$tmp/evidence" \
  PUBLIC_BFT_CUTOVER_TRANSACTION_ID="$id" \
  CUTOVER_TEST_STATE="$state" \
  CUTOVER_TEST_BASELINE="$baseline" \
  CUTOVER_TEST_FAIL_PHASE="$fail_phase" \
  bash scripts/ops/public-bft-cutover-transaction.sh)
}

plan="$(cd "$repo" && PUBLIC_BFT_CUTOVER_MODE=plan bash scripts/ops/public-bft-cutover-transaction.sh)"
grep -Fq 'plan only: no service, state, mutation route, or public ingress was changed' <<<"$plan"

for phase in freeze_mutations pause_authoritative export_final_snapshot deploy_candidate verify_candidate start_dependencies verify_continuity switch_ingress verify_public unfreeze_mutations; do
  cp "$baseline" "$state"
  if run_transaction "fail-${phase}" "${phase}:after" >/dev/null 2>&1; then
    echo "failure injection unexpectedly passed at $phase" >&2
    exit 1
  fi
  cmp "$state" "$baseline" >/dev/null || { echo "rollback did not restore baseline after $phase" >&2; exit 1; }
  grep -Fq '"phase":"rollback","status":"passed"' "$tmp/evidence/fail-${phase}/journal.jsonl"
done

cp "$baseline" "$state"
run_transaction success-path >/dev/null
grep -Fxq 'ingress=bft' "$state"
grep -Fxq 'authoritative=paused' "$state"
grep -Fxq 'frozen=false' "$state"
grep -Fxq 'candidate=running' "$state"
grep -Fxq 'dependencies=bft' "$state"
grep -Fq '"phase":"transaction","status":"passed"' "$tmp/evidence/success-path/journal.jsonl"

cp "$baseline" "$state"
if run_transaction success-path >/dev/null 2>&1; then
  echo "reused transaction evidence directory unexpectedly passed" >&2
  exit 1
fi
cmp "$state" "$baseline" >/dev/null

cp "$tmp/approval.json" "$tmp/insecure-approval.json"
chmod 644 "$tmp/insecure-approval.json"
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/insecure-approval.json" "$commit" "$release") >/dev/null 2>&1; then
  echo "insecure approval permissions passed validation" >&2
  exit 1
fi
if (cd "$repo" && node scripts/verify/validate-public-bft-cutover-approval.mjs "$tmp/approval.json" 000000000000 ynx-bft-gateway-000000000000) >/dev/null 2>&1; then
  echo "approval bound to another commit unexpectedly passed validation" >&2
  exit 1
fi

echo "public-bft-cutover-transaction-check passed: plan is non-mutating, approval and evidence are commit/transaction-bound, success reaches BFT state, and ten injected failures restore the exact authoritative baseline"
