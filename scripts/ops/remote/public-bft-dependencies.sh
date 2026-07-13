#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?start or rollback is required}"
transaction_id="${2:?transaction id is required}"
commit="${3:?commit is required}"
bft_release="${4:?BFT release is required}"
migration_height="${5:?migration height is required}"
migration_hash="${6:?migration hash is required}"
evidence_root="${7:?evidence root is required}"
faucet_key="${8:-/etc/ynx/consensus-signers/faucet.key}"
faucet_address="${9:-0x0000000000000000000000000000000000000000}"
ai_key="${10:-/etc/ynx/consensus-signers/ai.key}"
ai_address="${11:-0x0000000000000000000000000000000000000000}"
pay_key="${12:-/etc/ynx/consensus-signers/pay.key}"
pay_address="${13:-0x0000000000000000000000000000000000000000}"
trust_key="${14:-/etc/ynx/consensus-signers/trust.key}"
trust_address="${15:-0x0000000000000000000000000000000000000000}"
resource_key="${16:-/etc/ynx/consensus-signers/resource.key}"
resource_address="${17:-0x0000000000000000000000000000000000000000}"

fail() { echo "$1" >&2; exit 1; }

[[ "$operation" == "start" || "$operation" == "rollback" ]] || fail "invalid dependency operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$migration_height" =~ ^[0-9]+$ ]] && ((migration_height > 0)) || fail "invalid migration height"
migration_hash="${migration_hash#0x}"
migration_hash="$(printf '%s' "$migration_hash" | tr '[:upper:]' '[:lower:]')"
[[ "$migration_hash" =~ ^[0-9a-f]{64}$ ]] || fail "invalid migration block hash"
for value in "$evidence_root" "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  [[ "$value" == /* && "$value" != *..* && "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid dependency path"
done
for key in "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  [[ "$key" == /etc/ynx/consensus-signers/* ]] || fail "signer keys must stay under /etc/ynx/consensus-signers"
done
for address in "$faucet_address" "$ai_address" "$pay_address" "$trust_address" "$resource_address"; do
  [[ "$address" =~ ^0x[0-9a-f]{40}$ ]] || fail "invalid signer address"
done

candidate_root=/var/lib/ynx-chain/consensus-candidate
dependency_root="/var/lib/ynx-chain/public-bft-cutover/${transaction_id}/dependencies"
env_root="/etc/ynx/public-bft-cutover/${transaction_id}"
candidate_env="$env_root/candidate.env"
ownership="$env_root/ownership.json"
mutation_marker=/var/lib/ynx-chain/mutation-freeze.json
pause_marker=/var/lib/ynx-chain/block-production-pause.json
authoritative_index=/var/lib/ynx-chain/indexer/indexer-db.json
services=(
  ynx-bft-gateway-candidate.service
  ynx-bft-indexer-candidate.service
  ynx-bft-explorer-candidate.service
  ynx-bft-faucet-candidate.service
  ynx-bft-ai-candidate.service
  ynx-bft-pay-candidate.service
  ynx-bft-trust-candidate.service
  ynx-bft-resource-candidate.service
)

owned_file() {
  local file="$1"
  test -s "$file" && grep -Fq "\"transactionId\":\"${transaction_id}\"" "$file" && grep -Fq "\"commit\":\"${commit}\"" "$file" && grep -Fq "\"bftRelease\":\"${bft_release}\"" "$file"
}

owned_start_inputs() {
  owned_file "$ownership" &&
    grep -Fq "\"migrationHeight\":${migration_height}" "$ownership" &&
    grep -Fq "\"migrationBlockHash\":\"${migration_hash}\"" "$ownership" &&
    grep -Fq "\"faucetKeyPath\":\"${faucet_key}\"" "$ownership" &&
    grep -Fq "\"faucetAddress\":\"${faucet_address}\"" "$ownership" &&
    grep -Fq "\"aiKeyPath\":\"${ai_key}\"" "$ownership" &&
    grep -Fq "\"aiAddress\":\"${ai_address}\"" "$ownership" &&
    grep -Fq "\"payKeyPath\":\"${pay_key}\"" "$ownership" &&
    grep -Fq "\"payAddress\":\"${pay_address}\"" "$ownership" &&
    grep -Fq "\"trustKeyPath\":\"${trust_key}\"" "$ownership" &&
    grep -Fq "\"trustAddress\":\"${trust_address}\"" "$ownership" &&
    grep -Fq "\"resourceKeyPath\":\"${resource_key}\"" "$ownership" &&
    grep -Fq "\"resourceAddress\":\"${resource_address}\"" "$ownership"
}

write_unit() {
  local name="$1" description="$2" after="$3" binary="$4" extra_env="$5" write_paths="$6"
  cat >"/etc/systemd/system/$name" <<EOF
[Unit]
Description=$description
After=network-online.target $after
Wants=network-online.target $after

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
$extra_env
EnvironmentFile=$candidate_env
ExecStart=$binary
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$write_paths

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "/etc/systemd/system/$name"
}

rollback_dependencies() {
  local unit
  if [[ -e "$ownership" ]] && ! owned_file "$ownership"; then
    fail "dependency ownership belongs to another transaction"
  fi
  for unit in "${services[@]}"; do
    if [[ -e "/etc/systemd/system/$unit" ]]; then
      grep -Fq "EnvironmentFile=$candidate_env" "/etc/systemd/system/$unit" || fail "refusing to remove foreign dependency unit $unit"
    fi
  done
  systemctl disable --now "${services[@]}" >/dev/null 2>&1 || true
  rm -f "${services[@]/#//etc/systemd/system/}"
  systemctl daemon-reload
  rm -rf "$env_root" "$dependency_root"
  for unit in "${services[@]}"; do
    ! systemctl is-active --quiet "$unit" || fail "candidate dependency service remains active: $unit"
  done
  for service in ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
    systemctl is-active "$service" >/dev/null || fail "authoritative service is not active after dependency rollback: $service"
  done
  ! ss -ltn | awk '{print $4}' | grep -Eq ':(27620|27626|27627|27628|27629|27630|27631|27632)$' || fail "candidate dependency port remains open"
  install -d -m 0700 "$evidence_root"
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","authoritativeServicesActive":true,"candidateDependencyServicesAbsent":true,"candidatePortsFree":true,"rolledBack":true,"recordedAt":"%s"}\n' \
    "$transaction_id" "$commit" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_root/primary-dependencies-rollback.json"
  chmod 0600 "$evidence_root/primary-dependencies-rollback.json"
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nauthoritativeServicesActive=true\ncandidateDependencyServicesAbsent=true\ncandidatePortsFree=true\nrolledBack=true\n' "$transaction_id" "$commit" "$bft_release"
}

if [[ "$operation" == "rollback" ]]; then
  rollback_dependencies
  exit 0
fi

if [[ -e "$ownership" ]]; then
  owned_start_inputs || fail "existing dependency state does not match the approved start inputs"
  for service in "${services[@]}"; do systemctl is-active "$service" >/dev/null; done
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ndependenciesActive=true\n' "$transaction_id" "$commit" "$bft_release"
  exit 0
fi

owned_file "$mutation_marker" || fail "owned mutation freeze marker is required"
owned_file "$pause_marker" || fail "owned authoritative pause marker is required"
for service in ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service; do
  systemctl is-active "$service" >/dev/null || fail "required service is not active: $service"
done
for binary in ynx-bft-gatewayd ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  test -x "$candidate_root/bin/$binary" || fail "transaction candidate binary is missing: $binary"
done
for key in "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  test -s "$key" || fail "signer key is missing"
  [[ "$(stat -c %a "$key")" == 600 ]] || fail "signer key must be mode 0600"
  [[ "$(stat -c %U "$key")" == ynx ]] || fail "signer key must be owned by ynx"
done

for _attempt in $(seq 1 20); do
  health="$(curl -fsS http://127.0.0.1:6426/health)" || true
  indexed="$(printf '%s' "$health" | sed -n 's/.*"lastIndexedHeight":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  [[ "$indexed" == "$migration_height" ]] && break
  sleep 1
done
[[ "${indexed:-}" == "$migration_height" ]] || fail "authoritative indexer did not reach the final snapshot height"
test -s "$authoritative_index" || fail "authoritative index database is missing"
indexed_hash="$(sed -n 's/.*"lastBlockHash":[[:space:]]*"\([0-9a-fA-F]\{64\}\)".*/\1/p' "$authoritative_index" | head -1 | tr '[:upper:]' '[:lower:]')"
[[ "$indexed_hash" == "$migration_hash" ]] || fail "authoritative index tip does not match the final snapshot hash"

umask 077
install -d -m 0700 -o ynx -g ynx "$dependency_root/indexer" "$dependency_root/log"
install -m 0600 -o ynx -g ynx "$authoritative_index" "$dependency_root/indexer/indexer-db.json"
install -d -m 0700 "$env_root"
cat >"$candidate_env" <<EOF
YNX_BFT_GATEWAY_HTTP_ADDR=127.0.0.1:27620
YNX_BFT_GATEWAY_COMET_RPC_URL=http://127.0.0.1:27757
YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false
YNX_BFT_GATEWAY_MIGRATION_HEIGHT=$migration_height
YNX_BFT_GATEWAY_MIGRATION_BLOCK_HASH=$migration_hash
YNX_INDEXER_RPC_URL=http://127.0.0.1:27620
YNX_INDEXER_HTTP_ADDR=127.0.0.1:27626
YNX_INDEXER_DB_PATH=$dependency_root/indexer/indexer-db.json
YNX_EXPLORER_RPC_URL=http://127.0.0.1:27620
YNX_EXPLORER_INDEXER_URL=http://127.0.0.1:27626
YNX_EXPLORER_HTTP_ADDR=127.0.0.1:27627
YNX_FAUCET_RPC_URL=http://127.0.0.1:27620
YNX_FAUCET_HTTP_ADDR=127.0.0.1:27628
YNX_FAUCET_UPSTREAM_MODE=bft
FAUCET_PRIVATE_KEY=
YNX_FAUCET_PRIVATE_KEY_FILE=$faucet_key
YNX_FAUCET_ADDRESS=$faucet_address
YNX_FAUCET_REQUEST_LOG=$dependency_root/log/faucet.jsonl
YNX_AI_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_AI_GATEWAY_HTTP_ADDR=127.0.0.1:27629
YNX_AI_GATEWAY_UPSTREAM_MODE=bft
YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$ai_key
YNX_AI_GATEWAY_SIGNER_ADDRESS=$ai_address
YNX_AI_GATEWAY_AUDIT_LOG=$dependency_root/log/ai.jsonl
YNX_PAY_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_PAY_GATEWAY_HTTP_ADDR=127.0.0.1:27630
YNX_PAY_GATEWAY_UPSTREAM_MODE=bft
YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$pay_key
YNX_PAY_GATEWAY_SIGNER_ADDRESS=$pay_address
YNX_PAY_GATEWAY_AUDIT_LOG=$dependency_root/log/pay.jsonl
YNX_TRUST_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_TRUST_GATEWAY_HTTP_ADDR=127.0.0.1:27631
YNX_TRUST_GATEWAY_UPSTREAM_MODE=bft
YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$trust_key
YNX_TRUST_GATEWAY_SIGNER_ADDRESS=$trust_address
YNX_TRUST_GATEWAY_AUDIT_LOG=$dependency_root/log/trust.jsonl
YNX_RESOURCE_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_RESOURCE_GATEWAY_HTTP_ADDR=127.0.0.1:27632
YNX_RESOURCE_GATEWAY_UPSTREAM_MODE=bft
YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$resource_key
YNX_RESOURCE_GATEWAY_SIGNER_ADDRESS=$resource_address
YNX_RESOURCE_GATEWAY_AUDIT_LOG=$dependency_root/log/resource.jsonl
EOF
chmod 0640 "$candidate_env"
chown root:ynx "$candidate_env"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","migrationHeight":%s,"migrationBlockHash":"%s","faucetKeyPath":"%s","faucetAddress":"%s","aiKeyPath":"%s","aiAddress":"%s","payKeyPath":"%s","payAddress":"%s","trustKeyPath":"%s","trustAddress":"%s","resourceKeyPath":"%s","resourceAddress":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$faucet_key" "$faucet_address" "$ai_key" "$ai_address" "$pay_key" "$pay_address" "$trust_key" "$trust_address" "$resource_key" "$resource_address" >"$ownership"
chmod 0600 "$ownership"

write_unit ynx-bft-gateway-candidate.service "YNX BFT candidate compatibility gateway" ynx-consensus-comet-candidate.service "$candidate_root/bin/ynx-bft-gatewayd" "" "$candidate_root $dependency_root"
write_unit ynx-bft-indexer-candidate.service "YNX BFT candidate indexer" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-indexerd" "" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-explorer-candidate.service "YNX BFT candidate explorer" ynx-bft-indexer-candidate.service "$candidate_root/bin/ynx-explorerd" "" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-faucet-candidate.service "YNX BFT candidate faucet" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-faucetd" "EnvironmentFile=/etc/ynx/ynx-faucetd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-ai-candidate.service "YNX BFT candidate AI Gateway" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-ai-gatewayd" "EnvironmentFile=/etc/ynx/ynx-ai-gatewayd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-pay-candidate.service "YNX BFT candidate Pay API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-payd" "EnvironmentFile=/etc/ynx/ynx-payd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-trust-candidate.service "YNX BFT candidate Trust API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-trustd" "EnvironmentFile=/etc/ynx/ynx-trustd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-resource-candidate.service "YNX BFT candidate Resource API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-resourced" "EnvironmentFile=/etc/ynx/ynx-resourced.env" "$dependency_root /var/log/ynx-chain"

systemctl daemon-reload
systemctl enable --now "${services[@]}" >/dev/null
for port in 27620 27626 27627 27628 27629 27630 27631 27632; do
  ready=false
  for _attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "candidate dependency health failed on port $port"
done

install -d -m 0700 "$evidence_root"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","migrationHeight":%s,"migrationBlockHash":"%s","authoritativeIndexerBoundaryVerified":true,"parallelCandidatePorts":true,"dependenciesActive":true,"reused":false,"recordedAt":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_root/primary-dependencies-start.json"
chmod 0600 "$evidence_root/primary-dependencies-start.json"
printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nmigrationHeight=%s\nmigrationBlockHash=%s\nauthoritativeIndexerBoundaryVerified=true\nparallelCandidatePorts=true\ndependenciesActive=true\nreused=false\n' "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash"
