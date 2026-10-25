#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
stat_platform="$(uname -s)"
mode_of() {
  case "$stat_platform" in
    Linux) stat -c '%a' -- "$1" ;;
    Darwin) stat -f '%Lp' "$1" ;;
    *) echo "unsupported stat platform for exact ceremony permissions" >&2; return 1 ;;
  esac
}
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
  [[ "$(mode_of "$dir")" == 700 ]]
done
for role in faucet ai pay trust resource; do
  [[ "$(mode_of "$custody/keys/$role.key")" == 600 ]]
  [[ "$(mode_of "$recovery/keys/$role.key")" == 600 ]]
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
chmod 0644 "$custody/keys/faucet.key"
if YNX_SERVICE_SIGNER_CEREMONY_MODE=verify YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" bash scripts/ops/init-production-service-signers.sh >"$tmp/unsafe-mode.log" 2>&1; then
  echo "world-readable owner key unexpectedly passed verification" >&2
  exit 1
fi
grep -Fq 'faucet signer key permissions must be 0600' "$tmp/unsafe-mode.log"
[[ "$(mode_of "$custody/keys/faucet.key")" == 644 ]]
chmod 0600 "$custody/keys/faucet.key"
printf '\001' | dd of="$recovery/keys/ai.key" bs=1 seek=0 conv=notrunc status=none
if YNX_SERVICE_SIGNER_CEREMONY_MODE=verify YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" bash scripts/ops/init-production-service-signers.sh >/dev/null 2>&1; then
  echo "tampered recovery key unexpectedly passed verification" >&2
  exit 1
fi

echo "production-service-signer-ceremony-check passed: five distinct owner-local keys, mode-restricted recovery copies, public manifest, no overwrite, tamper rejection, and no remote/hand-over/rotation claim"
