#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops/remote" "$repo/scripts/deploy" "$repo/scripts/verify"
cp scripts/ops/public-bft-production-driver.sh scripts/ops/lib.sh "$repo/scripts/ops/"
cp scripts/ops/remote/public-bft-scoped-backup.sh "$repo/scripts/ops/remote/"
cp scripts/deploy/lib.sh "$repo/scripts/deploy/"
git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'production driver fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
transaction="$tmp/cutover-${commit}-fixture"
mkdir -p "$transaction"

cat >"$tmp/deploy.env" <<EOF
PRIMARY_NODE_HOST=primary.test
PRIMARY_NODE_USER=ubuntu
PRIMARY_NODE_SSH_KEY=$tmp/primary.pem
SG_NODE_HOST=singapore.test
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/singapore.pem
SILICON_VALLEY_NODE_HOST=silicon-valley.test
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/silicon-valley.pem
SEOUL_NODE_HOST=seoul.test
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/seoul.pem
BACKUP_STORAGE_PATH=/var/backups/ynx-chain
EOF

run_backup() {
  (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh backup)
}

run_backup >/dev/null
for role in primary singapore silicon-valley seoul; do
  evidence="$transaction/roles/${role}-backup.txt"
  test -s "$evidence"
  grep -Fq "DRY RUN [$role]" "$evidence"
  grep -Fq "/public-bft-cutover/$(basename "$transaction")" "$evidence"
  grep -Fq "$role" "$evidence"
done
grep -Fq true "$transaction/roles/primary-backup.txt"
grep -Fq false "$transaction/roles/singapore-backup.txt"
grep -Fq '.tar.gz.partial' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq 'tar -tzf' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq 'sha256sum' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
grep -Fq '"validated":true' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
if grep -Eq '/(home/ubuntu|root)/\.ynx-v2|ynx-ops-observer|ynx-v2-' "$repo/scripts/ops/remote/public-bft-scoped-backup.sh"; then
  echo "scoped backup helper includes unrelated legacy state" >&2
  exit 1
fi

source_root="$tmp/source-root"
backup_root="$tmp/remote-backup/$(basename "$transaction")"
mkdir -p "$source_root/etc/ynx" "$source_root/etc/systemd/system" \
  "$source_root/etc/caddy" "$source_root/var/lib/ynx-chain/testnet" \
  "$source_root/var/lib/ynx-chain/indexer"
printf 'fixture=true\n' >"$source_root/etc/ynx/ynx-chaind.env"
printf '[Unit]\nDescription=fixture\n' >"$source_root/etc/systemd/system/ynx-chaind.service"
printf 'chain-state\n' >"$source_root/var/lib/ynx-chain/testnet/state.json"
printf 'index-state\n' >"$source_root/var/lib/ynx-chain/indexer/index.json"
printf 'fixture ingress\n' >"$source_root/etc/caddy/ynx-chain.caddy"

helper="$repo/scripts/ops/remote/public-bft-scoped-backup.sh"
first="$($helper "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root")"
grep -Fq 'validated=true' <<<"$first"
grep -Fq 'reused=false' <<<"$first"
test -s "$backup_root/primary.tar.gz"
test -s "$backup_root/primary.json"
grep -Fq '"validated":true' "$backup_root/primary.json"
tar -tzf "$backup_root/primary.tar.gz" | grep -Fxq 'var/lib/ynx-chain/indexer/index.json'
if tar -tzf "$backup_root/primary.tar.gz" | grep -Eq '(^|/)\.ynx-v2(/|$)|ynx-ops-observer'; then
  echo "functional scoped archive contains unrelated legacy state" >&2
  exit 1
fi
second="$($helper "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root")"
grep -Fq 'reused=true' <<<"$second"
cp "$backup_root/primary.json" "$backup_root/primary.json.valid"
printf '{"transactionId":"wrong"}\n' >"$backup_root/primary.json"
if "$helper" "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$backup_root" true "$source_root" >/dev/null 2>&1; then
  echo "tampered backup evidence unexpectedly passed" >&2
  exit 1
fi
mv "$backup_root/primary.json.valid" "$backup_root/primary.json"

if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_CUTOVER_COMMIT="$commit" PUBLIC_BFT_CUTOVER_RELEASE="$release" \
  PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed without explicit approval" >&2
  exit 1
fi
if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes PUBLIC_BFT_CUTOVER_COMMIT=000000000000 \
  PUBLIC_BFT_CUTOVER_RELEASE="$release" PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed with a mismatched commit" >&2
  exit 1
fi
if (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
  PUBLIC_BFT_PRODUCTION_BACKUP_APPROVED=yes PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
  PUBLIC_BFT_CUTOVER_RELEASE=ynx-bft-gateway-000000000000 PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
  bash scripts/ops/public-bft-production-driver.sh backup) >/dev/null 2>&1; then
  echo "backup unexpectedly passed with a mismatched BFT release" >&2
  exit 1
fi

echo "public-bft-production-driver-check passed: scoped backup is transaction-bound, approval-gated, checksum-validated, idempotent by evidence, and excludes unrelated legacy V2 state"
