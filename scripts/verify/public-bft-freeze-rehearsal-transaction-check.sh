#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops" "$repo/scripts/verify/lib"
cp scripts/ops/public-bft-freeze-rehearsal-transaction.sh "$repo/scripts/ops/"
cp scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$repo/scripts/verify/"
cp scripts/verify/validate-production-custody-review.mjs "$repo/scripts/verify/"
cp scripts/verify/validate-owner-handover-receipt.mjs "$repo/scripts/verify/"
cp scripts/verify/lib/owner-handover.mjs "$repo/scripts/verify/lib/"
git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'freeze rehearsal fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
future="$(date -u -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
reviewed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
service_signer_manifest_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
owner_binding="$(node scripts/verify/write-owner-handover-fixture.mjs "$tmp" "$commit")"
custody_review="$tmp/custody-review.json"
cat >"$custody_review" <<EOF
{"schemaVersion":1,"action":"ynx-production-custody-review","reviewId":"review-${commit}","reviewer":"custody self test","reviewed":true,"commit":"${commit}","publicManifestSha256":"${service_signer_manifest_sha}","sourceCeremonyStatusSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","signerCount":5,"records":[{"role":"faucet","purpose":"ynx-production-faucet-signer","address":"0x1111111111111111111111111111111111111111"},{"role":"ai","purpose":"ynx-production-ai-signer","address":"0x2222222222222222222222222222222222222222"},{"role":"pay","purpose":"ynx-production-pay-signer","address":"0x3333333333333333333333333333333333333333"},{"role":"trust","purpose":"ynx-production-trust-signer","address":"0x4444444444444444444444444444444444444444"},{"role":"resource","purpose":"ynx-production-resource-signer","address":"0x5555555555555555555555555555555555555555"}],"validatorKeyRecoveryVerified":true,"serviceSignerRecoveryVerified":true,"ownerHandoverVerified":true,"rotationProcedureVerified":true,"validatorRecoveryEvidence":"offline:validator-restore-001","serviceSignerRecoveryEvidence":"offline:service-restore-001","ownerHandoverEvidence":"handover:owner-ack-001","rotationProcedureEvidence":"rotation:review-001","reviewedAt":"${reviewed_at}","expiresAt":"${future}"}
EOF
node - "$custody_review" "$owner_binding" <<'NODE'
const fs=require("fs"),[file,binding]=process.argv.slice(2),review=JSON.parse(fs.readFileSync(file));
Object.assign(review,JSON.parse(binding));
fs.writeFileSync(file,`${JSON.stringify(review)}\n`,{mode:0o600});
NODE
chmod 600 "$custody_review"
custody_evidence="sha256:$(shasum -a 256 "$custody_review" | awk '{print $1}')"

write_approval() {
  local transaction_id="$1" path="$2"
  cat >"$path" <<EOF
{"schemaVersion":1,"action":"ynx-public-bft-freeze-rehearsal","approvalId":"approval-${transaction_id}","approver":"transaction self test","custodyReviewer":"custody self test","custodyEvidence":"${custody_evidence}","approved":true,"commit":"${commit}","release":"${release}","transactionId":"${transaction_id}","scopedBackupAuthorized":true,"temporaryMutationFreezeAuthorized":true,"automaticUnfreezeRequired":true,"validatorKeyRecoveryVerified":true,"serviceSignerRecoveryVerified":true,"ownerHandoverVerified":true,"rotationProcedureVerified":true,"serviceSignerManifestSha256":"${service_signer_manifest_sha}","authoritativePauseAuthorized":false,"publicIngressChangeAuthorized":false,"publicCutoverAuthorized":false,"maxFreezeSeconds":30,"expiresAt":"${future}"}
EOF
  chmod 600 "$path"
}

baseline="$tmp/baseline"
state="$tmp/state"
printf 'frozen=false\n' >"$baseline"
cat >"$tmp/driver" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
phase="$1"
state="${FREEZE_TEST_STATE:?}"
failure_marker="${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/failure-injected"
printf '%s\n' "$phase" >>"${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/driver-phases.txt"
if [[ "${FREEZE_TEST_FAIL_PHASE:-}" == "$phase" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  exit 72
fi
case "$phase" in
  preflight) grep -Fxq 'frozen=false' "$state" ;;
  backup) cp "$state" "${PUBLIC_BFT_CUTOVER_TRANSACTION_DIR}/state.backup" ;;
  freeze_mutations) printf 'frozen=true\n' >"$state" ;;
  unfreeze_mutations) printf 'frozen=false\n' >"$state" ;;
  verify_recovery) cmp "$state" "${FREEZE_TEST_BASELINE:?}" >/dev/null ;;
  *) echo "prohibited or unexpected phase: $phase" >&2; exit 64 ;;
esac
if [[ "${FREEZE_TEST_FAIL_PHASE:-}" == "${phase}:after" && ! -e "$failure_marker" ]]; then
  touch "$failure_marker"
  exit 73
fi
EOF
chmod 700 "$tmp/driver"

run_rehearsal() {
  local transaction_id="$1" fail_phase="${2:-}" approval
  approval="$tmp/${transaction_id}.json"
  write_approval "$transaction_id" "$approval"
  (cd "$repo" && PUBLIC_BFT_FREEZE_REHEARSAL_MODE=execute \
    PUBLIC_BFT_FREEZE_REHEARSAL_APPROVED=yes \
    PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_FILE="$approval" \
    PUBLIC_BFT_CUSTODY_REVIEW_FILE="$custody_review" \
    PUBLIC_BFT_FREEZE_REHEARSAL_DRIVER="$tmp/driver" \
    PUBLIC_BFT_FREEZE_REHEARSAL_EVIDENCE_DIR="$tmp/evidence" \
    PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID="$transaction_id" \
    FREEZE_TEST_STATE="$state" FREEZE_TEST_BASELINE="$baseline" \
    FREEZE_TEST_FAIL_PHASE="$fail_phase" \
    bash scripts/ops/public-bft-freeze-rehearsal-transaction.sh)
}

plan="$(cd "$repo" && PUBLIC_BFT_FREEZE_REHEARSAL_MODE=plan bash scripts/ops/public-bft-freeze-rehearsal-transaction.sh)"
grep -Fq 'bounded phase: preflight' <<<"$plan"
grep -Fq 'prohibited: authoritative pause, candidate deployment, dependency transition, public ingress change, and public cutover' <<<"$plan"

cp "$baseline" "$state"
run_rehearsal successful-rehearsal >/dev/null
cmp "$state" "$baseline" >/dev/null
grep -Fq '"phase":"transaction","status":"passed"' "$tmp/evidence/successful-rehearsal/journal.jsonl"
grep -Eq '"phase":"freeze_window","status":"passed","durationSeconds":[0-9]+,"maximumSeconds":30' "$tmp/evidence/successful-rehearsal/journal.jsonl"
expected_phases=$'preflight\nbackup\nfreeze_mutations\nunfreeze_mutations\nverify_recovery'
[[ "$(cat "$tmp/evidence/successful-rehearsal/driver-phases.txt")" == "$expected_phases" ]]

for failure in freeze_mutations:after unfreeze_mutations verify_recovery; do
  id="failure-${failure//[:_]/-}"
  cp "$baseline" "$state"
  if run_rehearsal "$id" "$failure" >/dev/null 2>&1; then
    echo "failure injection unexpectedly passed: $failure" >&2
    exit 1
  fi
  cmp "$state" "$baseline" >/dev/null || { echo "automatic unfreeze did not restore baseline: $failure" >&2; exit 1; }
  grep -Fq '"phase":"automatic_unfreeze","status":"passed"' "$tmp/evidence/$id/journal.jsonl"
done

approval="$tmp/rejected.json"
write_approval rejected-approval "$approval"
node -e 'const fs=require("fs"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p)); a.authoritativePauseAuthorized=true; fs.writeFileSync(p,JSON.stringify(a));' "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-approval "$custody_review") >/dev/null 2>&1; then
  echo "approval authorizing authoritative pause unexpectedly passed" >&2
  exit 1
fi
write_approval rejected-custody "$approval"
node -e 'const fs=require("fs"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p)); a.serviceSignerRecoveryVerified=false; fs.writeFileSync(p,JSON.stringify(a));' "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-custody "$custody_review") >/dev/null 2>&1; then
  echo "approval without service signer recovery unexpectedly passed" >&2
  exit 1
fi
write_approval rejected-free-form-custody "$approval"
node -e 'const fs=require("fs"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p)); a.custodyEvidence="free-form-review-reference"; fs.writeFileSync(p,JSON.stringify(a));' "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-free-form-custody "$custody_review") >/dev/null 2>&1; then
  echo "free-form custody evidence unexpectedly passed" >&2
  exit 1
fi
write_approval rejected-self-review "$approval"
node -e 'const fs=require("fs"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p)); a.custodyReviewer=a.approver; fs.writeFileSync(p,JSON.stringify(a));' "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-self-review "$custody_review") >/dev/null 2>&1; then
  echo "self-reviewed custody approval unexpectedly passed" >&2
  exit 1
fi
write_approval rejected-owner-approver "$approval"
node -e 'const fs=require("fs"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p));a.approver="owner fixture";fs.writeFileSync(p,JSON.stringify(a));' "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-owner-approver "$custody_review") >/dev/null 2>&1; then
  echo "owner acting as freeze approver unexpectedly passed" >&2
  exit 1
fi
chmod 644 "$approval"
if (cd "$repo" && node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$commit" "$release" rejected-self-review "$custody_review") >/dev/null 2>&1; then
  echo "insecure approval permissions unexpectedly passed" >&2
  exit 1
fi

echo "public-bft-freeze-rehearsal-transaction-check passed: approval is transaction-bound and independently custody-gated, pause/ingress/cutover are explicitly prohibited, success always unfreezes, and injected freeze/unfreeze failures recover"
