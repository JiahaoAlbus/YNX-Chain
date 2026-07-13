#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
custody="$tmp-owner-custody"
recovery="$tmp-owner-recovery"
trap 'rm -rf "$tmp" "$custody" "$recovery"' EXIT

YNX_SERVICE_SIGNER_CEREMONY_MODE=create \
YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes \
YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" \
YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" \
bash scripts/ops/init-production-service-signers.sh >/dev/null

commit="$(git rev-parse --short=12 HEAD)"
packet_id="custody-review-self-test"
owner_source="$tmp/owner-source"
node scripts/verify/write-owner-handover-fixture.mjs "$owner_source" "$commit" "$custody/public/service-signers.json" >/dev/null
YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST="$custody/public/service-signers.json" \
YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS="$custody/public/CEREMONY_STATUS.json" \
YNX_OWNER_HANDOVER_INVENTORY="$owner_source/owner-handover-inventory.json" \
YNX_OWNER_HANDOVER_RECEIPT="$owner_source/owner-handover-receipt.json" \
YNX_PRODUCTION_CUSTODY_REVIEW_DIR="$tmp/packets" \
YNX_PRODUCTION_CUSTODY_REVIEW_ID="$packet_id" \
node scripts/ops/write-production-custody-review-packet.mjs >/dev/null

packet="$tmp/packets/$packet_id/review.template.json"
request="$tmp/packets/$packet_id/REVIEW_REQUEST.md"
owner_inventory="$tmp/packets/$packet_id/owner-handover-inventory.json"
owner_receipt="$tmp/packets/$packet_id/owner-handover-receipt.json"
manifest_sha="$(shasum -a 256 "$custody/public/service-signers.json" | awk '{print $1}')"
for file in "$packet" "$request" "$owner_inventory" "$owner_receipt"; do
  [[ "$(stat -f %Lp "$file" 2>/dev/null || stat -c %a "$file")" == 600 ]]
done
if node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "unreviewed custody template unexpectedly passed validation" >&2
  exit 1
fi

reviewed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
expires_at="$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"
node - "$packet" "$reviewed_at" "$expires_at" <<'NODE'
const fs = require("fs");
const [file, reviewedAt, expiresAt] = process.argv.slice(2);
const review = JSON.parse(fs.readFileSync(file));
Object.assign(review, {
  reviewId: "review-self-test-001",
  reviewer: "independent custody fixture",
  reviewed: true,
  validatorKeyRecoveryVerified: true,
  serviceSignerRecoveryVerified: true,
  ownerHandoverVerified: true,
  rotationProcedureVerified: true,
  validatorRecoveryEvidence: "offline:validator-restore-001",
  serviceSignerRecoveryEvidence: "offline:service-restore-001",
  ownerHandoverEvidence: "handover:owner-ack-001",
  rotationProcedureEvidence: "rotation:review-001",
  reviewedAt,
  expiresAt,
});
fs.writeFileSync(file, JSON.stringify(review, null, 2) + "\n", { mode: 0o600 });
NODE

result="$(node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$manifest_sha")"
node -e 'const r=JSON.parse(process.argv[1]); if(r.status!=="passed" || !/^sha256:[0-9a-f]{64}$/.test(r.custodyEvidence) || !/^sha256:[0-9a-f]{64}$/.test(r.ownerHandoverReceiptEvidence) || r.reviewer!=="independent custody fixture" || r.owner!=="owner fixture" || r.ownerHandoverReviewer!=="independent handover fixture") process.exit(1)' "$result"

cp "$packet" "$tmp/incomplete.json"
node -e 'const fs=require("fs"),p=process.argv[1],r=JSON.parse(fs.readFileSync(p));r.serviceSignerRecoveryVerified=false;fs.writeFileSync(p,JSON.stringify(r)+"\n",{mode:0o600})' "$tmp/incomplete.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/incomplete.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "incomplete custody review unexpectedly passed validation" >&2
  exit 1
fi
if node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$(printf '0%.0s' {1..64})" >/dev/null 2>&1; then
  echo "custody review bound to another manifest unexpectedly passed validation" >&2
  exit 1
fi
cp -R "$tmp/packets/$packet_id" "$tmp/tampered-owner"
printf ' ' >>"$tmp/tampered-owner/owner-handover-receipt.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/tampered-owner/review.template.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "custody review with tampered owner receipt unexpectedly passed" >&2
  exit 1
fi
cp -R "$tmp/packets/$packet_id" "$tmp/colliding-reviewer"
node -e 'const fs=require("fs"),p=process.argv[1],r=JSON.parse(fs.readFileSync(p));r.reviewer="owner fixture";fs.writeFileSync(p,JSON.stringify(r)+"\n",{mode:0o600})' "$tmp/colliding-reviewer/review.template.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/colliding-reviewer/review.template.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "custody review with owner acting as reviewer unexpectedly passed" >&2
  exit 1
fi
if YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST="$custody/public/service-signers.json" YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS="$custody/public/CEREMONY_STATUS.json" YNX_OWNER_HANDOVER_INVENTORY="$owner_source/owner-handover-inventory.json" YNX_OWNER_HANDOVER_RECEIPT="$owner_source/owner-handover-receipt.json" YNX_PRODUCTION_CUSTODY_REVIEW_DIR="$tmp/packets" YNX_PRODUCTION_CUSTODY_REVIEW_ID="$packet_id" node scripts/ops/write-production-custody-review-packet.mjs >/dev/null 2>&1; then
  echo "custody review generator unexpectedly overwrote an existing packet" >&2
  exit 1
fi

echo "production-custody-review-check passed: owner receipt/inventory are revalidated, signer/hash/evidence binding and reviewer separation are enforced, packet remains default-false and non-overwriting, and tampering is rejected"
