#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
custody="$tmp-owner-custody"
recovery="$tmp-owner-recovery"
trap 'rm -rf "$tmp" "$custody" "$recovery"' EXIT

plan="$(YNX_SERVICE_SIGNER_CEREMONY_MODE=plan bash scripts/ops/init-production-service-signers.sh)"
grep -Fq 'no remote install' <<<"$plan"

YNX_SERVICE_SIGNER_CEREMONY_MODE=create \
YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes \
YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" \
YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" \
bash scripts/ops/init-production-service-signers.sh >"$tmp/create.log"

YNX_SERVICE_SIGNER_CEREMONY_MODE=verify \
YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" \
YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" \
bash scripts/ops/init-production-service-signers.sh >"$tmp/verify.log"

for dir in "$custody" "$custody/keys" "$custody/public" "$recovery" "$recovery/keys" "$recovery/public"; do
  [[ "$(stat -f %Lp "$dir" 2>/dev/null || stat -c %a "$dir")" == 700 ]]
done
for role in faucet ai pay trust resource; do
  [[ "$(stat -f %Lp "$custody/keys/$role.key" 2>/dev/null || stat -c %a "$custody/keys/$role.key")" == 600 ]]
  [[ "$(stat -f %Lp "$recovery/keys/$role.key" 2>/dev/null || stat -c %a "$recovery/keys/$role.key")" == 600 ]]
  cmp "$custody/keys/$role.key" "$recovery/keys/$role.key" >/dev/null
done
node -e '
const fs=require("fs"), manifest=JSON.parse(fs.readFileSync(process.argv[1])), status=JSON.parse(fs.readFileSync(process.argv[2]));
if (manifest.records.length!==5 || new Set(manifest.records.map((r)=>r.address)).size!==5) process.exit(1);
if (!status.distinctAddressesVerified || !status.ownerLocalKeysModeRestricted || !status.ownerDesignatedRecoveryCopyMatched) process.exit(1);
for (const key of ["remoteSignerInstallCompleted","offlineRecoveryVerified","ownerHandoverVerified","rotationProcedureVerified","independentCustodyReviewVerified"]) if (status[key]!==false) process.exit(1);
' "$custody/public/service-signers.json" "$custody/public/CEREMONY_STATUS.json"

if YNX_SERVICE_SIGNER_CEREMONY_MODE=create YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" bash scripts/ops/init-production-service-signers.sh >/dev/null 2>&1; then
  echo "ceremony unexpectedly overwrote existing owner keys" >&2
  exit 1
fi
printf '\001' | dd of="$recovery/keys/ai.key" bs=1 seek=0 conv=notrunc status=none
if YNX_SERVICE_SIGNER_CEREMONY_MODE=verify YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" bash scripts/ops/init-production-service-signers.sh >/dev/null 2>&1; then
  echo "tampered recovery key unexpectedly passed verification" >&2
  exit 1
fi

echo "production-service-signer-ceremony-check passed: five distinct owner-local keys, mode-restricted recovery copies, public manifest, no overwrite, tamper rejection, and no remote/hand-over/rotation claim"
