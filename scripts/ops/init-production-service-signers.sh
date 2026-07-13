#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

mode="${YNX_SERVICE_SIGNER_CEREMONY_MODE:-plan}"
case "$mode" in
  plan|create|verify) ;;
  *) echo "YNX_SERVICE_SIGNER_CEREMONY_MODE must be plan, create, or verify" >&2; exit 1 ;;
esac

roles=(faucet ai pay trust resource)
if [[ "$mode" == "plan" ]]; then
  printf '%s\n' 'production service signer ceremony plan: create five distinct owner-local mode-0600 secp256k1 keys, verify an owner-designated recovery copy, and emit public address/status records'
  printf '%s\n' 'no remote install: offline recovery, owner handover, rotation, and independent review remain false until separately evidenced'
  exit 0
fi

custody_dir="${YNX_SERVICE_SIGNER_CUSTODY_DIR:-}"
recovery_dir="${YNX_SERVICE_SIGNER_RECOVERY_DIR:-}"
[[ "$custody_dir" == /* && "$recovery_dir" == /* ]] || { echo "absolute YNX_SERVICE_SIGNER_CUSTODY_DIR and YNX_SERVICE_SIGNER_RECOVERY_DIR are required" >&2; exit 1; }
[[ "$custody_dir" != "$recovery_dir" ]] || { echo "custody and recovery directories must differ" >&2; exit 1; }
repo_root="$PWD"
case "$custody_dir/" in "$repo_root/"*) echo "custody directory must remain outside the Git repository" >&2; exit 1 ;; esac
case "$recovery_dir/" in "$repo_root/"*) echo "recovery directory must remain outside the Git repository" >&2; exit 1 ;; esac

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
go build -trimpath -o "$work/ynx-consensus-account-key" ./cmd/ynx-consensus-account-key

mode_of() {
  stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"
}

purpose_for() {
  printf 'ynx-production-%s-signer' "$1"
}

inspect_pair() {
  local role="$1" purpose custody_key recovery_key custody_record recovery_record
  purpose="$(purpose_for "$role")"
  custody_key="$custody_dir/keys/$role.key"
  recovery_key="$recovery_dir/keys/$role.key"
  custody_record="$custody_dir/public/$role.json"
  recovery_record="$recovery_dir/public/$role.json"
  [[ "$(mode_of "$custody_key")" == 600 && "$(mode_of "$recovery_key")" == 600 ]] || { echo "$role signer key permissions must be 0600" >&2; exit 1; }
  "$work/ynx-consensus-account-key" -mode inspect -owner-controlled -purpose "$purpose" -key "$custody_key" -public-record "$custody_record" >/dev/null
  "$work/ynx-consensus-account-key" -mode inspect -owner-controlled -purpose "$purpose" -key "$recovery_key" -public-record "$recovery_record" >/dev/null
  cmp "$custody_key" "$recovery_key" >/dev/null || { echo "$role recovery key does not match owner custody key" >&2; exit 1; }
  cmp "$custody_record" "$recovery_record" >/dev/null || { echo "$role public recovery identity mismatch" >&2; exit 1; }
}

if [[ "$mode" == "create" ]]; then
  [[ "${YNX_SERVICE_SIGNER_CEREMONY_APPROVED:-}" == yes ]] || { echo "YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes is required for create mode" >&2; exit 1; }
  [[ ! -e "$custody_dir" && ! -e "$recovery_dir" ]] || { echo "custody and recovery output directories must not already exist" >&2; exit 1; }
  install -d -m 0700 "$custody_dir/keys" "$custody_dir/public" "$recovery_dir/keys" "$recovery_dir/public"
  for role in "${roles[@]}"; do
    purpose="$(purpose_for "$role")"
    "$work/ynx-consensus-account-key" -mode create -owner-controlled -purpose "$purpose" -key "$custody_dir/keys/$role.key" -public-record "$custody_dir/public/$role.json" >/dev/null
    install -m 0600 "$custody_dir/keys/$role.key" "$recovery_dir/keys/$role.key"
  done
else
  [[ -d "$custody_dir/keys" && -d "$custody_dir/public" && -d "$recovery_dir/keys" && -d "$recovery_dir/public" ]] || { echo "existing custody and recovery ceremony directories are required" >&2; exit 1; }
fi

for dir in "$custody_dir" "$custody_dir/keys" "$custody_dir/public" "$recovery_dir" "$recovery_dir/keys" "$recovery_dir/public"; do
  chmod 0700 "$dir"
done
for role in "${roles[@]}"; do
  inspect_pair "$role"
done

node - "$custody_dir/public" "$custody_dir/public/service-signers.json" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const [root, output] = process.argv.slice(2);
const roles = ["faucet", "ai", "pay", "trust", "resource"];
const records = roles.map((role) => {
  const value = JSON.parse(fs.readFileSync(path.join(root, `${role}.json`), "utf8"));
  if (value.version !== 1 || value.purpose !== `ynx-production-${role}-signer` || value.custodyBoundary !== "owner-local-mode-0600" || !/^0x[0-9a-f]{40}$/.test(value.address)) process.exit(1);
  return { role, purpose: value.purpose, address: value.address };
});
if (new Set(records.map((record) => record.address)).size !== records.length) process.exit(1);
const manifest = { schemaVersion: 1, purpose: "ynx-production-service-signer-public-manifest", generatedAt: new Date().toISOString(), records };
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
const status = {
  schemaVersion: 1,
  purpose: "ynx-production-service-signer-ceremony-status",
  publicManifestSha256: crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex"),
  signerCount: records.length,
  distinctAddressesVerified: true,
  ownerLocalKeysModeRestricted: true,
  ownerDesignatedRecoveryCopyMatched: true,
  remoteSignerInstallCompleted: false,
  offlineRecoveryVerified: false,
  ownerHandoverVerified: false,
  rotationProcedureVerified: false,
  independentCustodyReviewVerified: false
};
fs.writeFileSync(path.join(path.dirname(output), "CEREMONY_STATUS.json"), JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
NODE
install -m 0600 "$custody_dir/public/service-signers.json" "$recovery_dir/public/service-signers.json"
install -m 0600 "$custody_dir/public/CEREMONY_STATUS.json" "$recovery_dir/public/CEREMONY_STATUS.json"

printf 'production service signer ceremony %s verified: signerCount=5 custody=%s recovery=%s remoteInstall=false offlineRecovery=false ownerHandover=false rotation=false independentReview=false\n' "$mode" "$custody_dir" "$recovery_dir"
