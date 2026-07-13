#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops/remote" "$repo/scripts/deploy" "$repo/scripts/verify"
cp scripts/ops/public-bft-production-driver.sh scripts/ops/lib.sh "$repo/scripts/ops/"
cp scripts/ops/remote/public-bft-scoped-backup.sh "$repo/scripts/ops/remote/"
cp scripts/ops/remote/public-bft-mutation-freeze.sh "$repo/scripts/ops/remote/"
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

for role in primary singapore silicon-valley seoul; do
  cat >"$transaction/roles/${role}-backup.txt" <<EOF
transactionId=$(basename "$transaction")
role=$role
commit=$commit
bftRelease=$release
validated=true
EOF
done

run_freeze_dry_run() {
  local phase="$1" approval="${2:-yes}"
  (cd "$repo" && ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_FREEZE_APPROVED="$approval" \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh "$phase")
}

run_freeze_dry_run freeze_mutations >/dev/null
run_freeze_dry_run unfreeze_mutations >/dev/null
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/roles/${role}-freeze.txt"
  grep -Fq mutation-freeze.json "$transaction/roles/${role}-freeze.txt"
  grep -Fq freeze "$transaction/roles/${role}-freeze.txt"
  grep -Fq unfreeze "$transaction/roles/${role}-unfreeze.txt"
done
grep -Fq '127.0.0.1:6432' "$transaction/roles/primary-freeze.txt"
if grep -Fq '127.0.0.1:6432' "$transaction/roles/singapore-freeze.txt"; then
  echo "validator-only freeze probe unexpectedly includes primary services" >&2
  exit 1
fi
if run_freeze_dry_run freeze_mutations no >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly passed without explicit approval" >&2
  exit 1
fi
rm "$transaction/roles/seoul-backup.txt"
if run_freeze_dry_run freeze_mutations yes >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly passed without four-role backup evidence" >&2
  exit 1
fi
run_freeze_dry_run verify_recovery >/dev/null
test -s "$transaction/recovery/dry-run.txt"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/recovery/roles/${role}-before-status.json"
done

marker="$tmp/mutation-freeze.json"
freeze_evidence="$tmp/freeze-evidence"
freeze_config="$tmp/freeze-config"
port_file="$tmp/probe-port"
mkdir -p "$freeze_evidence" "$freeze_config/etc/ynx" "$freeze_config/etc/systemd/system" "$tmp/freeze-archive/etc/ynx"
printf 'YNX_MUTATION_FREEZE_FILE=%s\n' "$marker" >"$freeze_config/etc/ynx/ynx-chaind.env"
for service_name in ynx-chaind ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  printf '[Service]\nEnvironmentFile=/etc/ynx/ynx-chaind.env\n' >"$freeze_config/etc/systemd/system/${service_name}.service"
done
printf 'fixture\n' >"$tmp/freeze-archive/etc/ynx/config"
tar -C "$tmp/freeze-archive" -czf "$freeze_evidence/primary.tar.gz" etc/ynx
freeze_backup_sha="$(sha256sum "$freeze_evidence/primary.tar.gz" | awk '{print $1}')"
printf '{"transactionId":"%s","role":"primary","commit":"%s","bftRelease":"%s","sha256":"%s","validated":true}\n' \
  "$(basename "$transaction")" "$commit" "$release" "$freeze_backup_sha" >"$freeze_evidence/primary.json"
cat >"$tmp/probe-server.mjs" <<'EOF'
import fs from "node:fs";
import http from "node:http";
const [marker, portFile] = process.argv.slice(2);
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/status") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end('{"status":"ok"}');
  }
  if (request.method === "POST" && request.url === "/evm") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end('{"jsonrpc":"2.0","id":1,"result":"0x1917"}');
  }
  if (request.method === "POST" && fs.existsSync(marker)) {
    response.writeHead(503, { "content-type": "application/json" });
    return response.end('{"status":"mutation_frozen"}');
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
EOF
node "$tmp/probe-server.mjs" "$marker" "$port_file" &
probe_pid=$!
trap 'kill "${probe_pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
for _ in {1..50}; do
  [[ -s "$port_file" ]] && break
  sleep 0.05
done
test -s "$port_file"
probe_url="http://127.0.0.1:$(cat "$port_file")"
freeze_helper="$repo/scripts/ops/remote/public-bft-mutation-freeze.sh"
cp "$freeze_evidence/primary.tar.gz" "$freeze_evidence/primary.tar.gz.valid"
printf 'tamper' >>"$freeze_evidence/primary.tar.gz"
if "$freeze_helper" freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly accepted a checksum-mismatched backup" >&2
  exit 1
fi
mv "$freeze_evidence/primary.tar.gz.valid" "$freeze_evidence/primary.tar.gz"
printf 'YNX_MUTATION_FREEZE_FILE=/wrong/marker\n' >"$freeze_config/etc/ynx/ynx-chaind.env"
if "$freeze_helper" freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "mutation freeze unexpectedly accepted a service with the wrong marker path" >&2
  exit 1
fi
printf 'YNX_MUTATION_FREEZE_FILE=%s\n' "$marker" >"$freeze_config/etc/ynx/ynx-chaind.env"
freeze_first="$($freeze_helper freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'mutationStateVerified=true' <<<"$freeze_first"
grep -Fq 'reused=false' <<<"$freeze_first"
test -s "$marker"
test -s "$freeze_evidence/primary-freeze.json"
freeze_second="$($freeze_helper freeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'reused=true' <<<"$freeze_second"
cp "$marker" "$marker.valid"
printf '{"transactionId":"another-transaction","commit":"%s","bftRelease":"%s"}\n' "$commit" "$release" >"$marker"
if "$freeze_helper" unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config" >/dev/null 2>&1; then
  echo "unfreeze unexpectedly removed another transaction's marker" >&2
  exit 1
fi
mv "$marker.valid" "$marker"
unfreeze_first="$($freeze_helper unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'mutationStateVerified=true' <<<"$unfreeze_first"
test ! -e "$marker"
unfreeze_second="$($freeze_helper unfreeze "$(basename "$transaction")" primary "$commit" "ynx-chain-${commit}" "$release" "$marker" "$freeze_evidence" "$probe_url" "$probe_url" "$freeze_config")"
grep -Fq 'reused=true' <<<"$unfreeze_second"
kill "$probe_pid"
wait "$probe_pid" 2>/dev/null || true
probe_pid=""

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

echo "public-bft-production-driver-check passed: scoped backup and mutation freeze/unfreeze are transaction-bound, approval/four-role-backup gated, fixture-tested, idempotent, and reject mismatched evidence"
