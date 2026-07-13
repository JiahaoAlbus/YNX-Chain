#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
transaction_id="freeze-rehearsal-template-check"
PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID="$transaction_id" \
PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_DIR="$tmp" \
node scripts/ops/write-public-bft-freeze-rehearsal-approval-template.mjs >/dev/null

packet="$tmp/$transaction_id"
approval="$packet/approval.template.json"
request="$packet/APPROVAL_REQUEST.md"
test "$(stat -f %Lp "$packet" 2>/dev/null || stat -c %a "$packet")" = 700
test "$(stat -f %Lp "$approval" 2>/dev/null || stat -c %a "$approval")" = 600
test "$(stat -f %Lp "$request" 2>/dev/null || stat -c %a "$request")" = 600
node -e '
const fs=require("fs"), a=JSON.parse(fs.readFileSync(process.argv[1]));
if (a.approved !== false || a.scopedBackupAuthorized !== false || a.temporaryMutationFreezeAuthorized !== false) process.exit(1);
if (a.custodyReviewer !== "" || a.custodyEvidence !== "") process.exit(1);
if (a.validatorKeyRecoveryVerified !== false || a.serviceSignerRecoveryVerified !== false || a.ownerHandoverVerified !== false || a.rotationProcedureVerified !== false) process.exit(1);
if (a.authoritativePauseAuthorized !== false || a.publicIngressChangeAuthorized !== false || a.publicCutoverAuthorized !== false) process.exit(1);
if (a.transactionId !== process.argv[2] || a.maxFreezeSeconds !== 60 || a.expiresAt !== "") process.exit(1);
' "$approval" "$transaction_id"
grep -Fq 'This packet does not authorize any remote action.' "$request"
grep -Fq 'Independent custody reviewer: required and must differ from the transaction approver' "$request"
grep -Fq 'Owner handover and rotation procedure: must be verified' "$request"
grep -Fq 'Authoritative pause: forbidden' "$request"
grep -Fq 'Public ingress change: forbidden' "$request"
grep -Fq 'Public cutover: forbidden' "$request"
if node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs "$approval" "$(git rev-parse --short=12 HEAD)" "ynx-bft-gateway-$(git rev-parse --short=12 HEAD)" "$transaction_id" >/dev/null 2>&1; then
  echo "unapproved template unexpectedly passed approval validation" >&2
  exit 1
fi

echo "public-bft-freeze-rehearsal-approval-template-check passed: generated packet is mode-restricted, current-commit-bound, independently custody-gated, explicitly unapproved, and forbids pause/ingress/cutover"
