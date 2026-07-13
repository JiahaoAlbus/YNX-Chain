#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?switch or rollback is required}"
transaction_id="${2:?transaction id is required}"
commit="${3:?commit is required}"
bft_release="${4:?BFT release is required}"
remote_root="${5:?remote evidence root is required}"

fail() { echo "$1" >&2; exit 1; }

[[ "$operation" == "switch" || "$operation" == "rollback" ]] || fail "invalid ingress operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$remote_root" == /* && "$remote_root" != *..* && "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid remote evidence root"

candidate_env="/etc/ynx/public-bft-cutover/${transaction_id}/candidate.env"
dependency_ownership="/etc/ynx/public-bft-cutover/${transaction_id}/ownership.json"
ingress_root="$remote_root/ingress"
ownership="$ingress_root/ownership.json"
switch_evidence="$ingress_root/switch.json"
rollback_evidence="$ingress_root/rollback.json"
caddy_config=/etc/caddy/ynx-chain.caddy
nginx_config=/etc/nginx/conf.d/ynx-chain.conf
files=()
[[ -f "$caddy_config" ]] && files+=("$caddy_config")
[[ -f "$nginx_config" ]] && files+=("$nginx_config")

owned() {
  local file="$1"
  test -s "$file" && grep -Fq "\"transactionId\":\"${transaction_id}\"" "$file" && grep -Fq "\"commit\":\"${commit}\"" "$file" && grep -Fq "\"bftRelease\":\"${bft_release}\"" "$file"
}

backup_name() {
  printf '%s' "$1" | sed 's#^/##; s#/#__#g'
}

load_owned_files() {
  local file checksum manifest_sha
  files=()
  test -s "$ingress_root/checksums.txt" || fail "ingress checksum manifest is missing"
  while IFS='=' read -r file checksum; do
    case "$file" in
      "$caddy_config"|"$nginx_config") ;;
      *) fail "ingress checksum manifest contains an unmanaged file" ;;
    esac
    [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || fail "ingress checksum manifest contains an invalid checksum"
    files+=("$file")
  done <"$ingress_root/checksums.txt"
  [[ ${#files[@]} -gt 0 ]] || fail "ingress checksum manifest contains no managed files"
  manifest_sha="$(sha256sum "$ingress_root/checksums.txt" | awk '{print $1}')"
  grep -Fq "\"authoritativeChecksumsSha256\":\"${manifest_sha}\"" "$ownership" || fail "ingress checksum manifest is not transaction-bound"
}

reload_active() {
  if systemctl is-active --quiet caddy; then
    caddy validate --config /etc/caddy/Caddyfile >/dev/null
    systemctl reload caddy
  fi
  if systemctl is-active --quiet nginx; then
    nginx -t >/dev/null
    systemctl reload nginx
  fi
}

wait_gateway_ready() {
  local expected="$1" ready=false payload
  for _attempt in $(seq 1 30); do
    payload="$(curl -fsS http://127.0.0.1:27620/health 2>/dev/null || true)"
    if printf '%s' "$payload" | grep -Fq "\"publicCutoverReady\":${expected}" && printf '%s' "$payload" | grep -Fq "\"commit\":\"${commit}\"" && printf '%s' "$payload" | grep -Fq "\"release\":\"${bft_release}\""; then
      ready=true
      break
    fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "BFT Gateway runtime authorization did not become ${expected}"
}

restore_files() {
  local file name backup expected actual
  for file in "${files[@]}"; do
    name="$(backup_name "$file")"
    backup="$ingress_root/backups/$name"
    test -s "$backup" || fail "ingress backup is missing: $file"
    expected="$(awk -F= -v key="$file" '$1 == key {print $2}' "$ingress_root/checksums.txt")"
    actual="$(sha256sum "$backup" | awk '{print $1}')"
    [[ -n "$expected" && "$actual" == "$expected" ]] || fail "ingress backup checksum mismatch: $file"
    install -m 0644 -o root -g root "$backup" "$file"
  done
  reload_active
}

verify_authoritative_files() {
  local file name backup expected current
  for file in "${files[@]}"; do
    name="$(backup_name "$file")"
    backup="$ingress_root/backups/$name"
    test -s "$backup" && test -s "$file" || fail "authoritative ingress file is missing: $file"
    expected="$(sha256sum "$backup" | awk '{print $1}')"
    current="$(sha256sum "$file" | awk '{print $1}')"
    [[ "$current" == "$expected" ]] || fail "authoritative ingress checksum is not restored: $file"
  done
  if [[ -s "$candidate_env" ]]; then
    grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate Gateway authorization is not false after rollback"
  fi
}

rollback_ingress() {
  if [[ -s "$rollback_evidence" ]]; then
    owned "$rollback_evidence" || fail "rollback evidence belongs to another transaction"
    owned "$ownership" || fail "transaction-owned ingress backup is required"
    load_owned_files
    verify_authoritative_files
    printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ningress=authoritative\npublicCutoverReady=false\n' "$transaction_id" "$commit" "$bft_release"
    return
  fi
  if [[ ! -e "$ownership" ]]; then
    printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nnoOp=true\ningress=authoritative\npublicCutoverReady=false\n' "$transaction_id" "$commit" "$bft_release"
    return
  fi
  owned "$ownership" || fail "transaction-owned ingress backup is required"
  load_owned_files
  restore_files
  if [[ -s "$candidate_env" ]]; then
    if grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true' "$candidate_env"; then
      sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false/' "$candidate_env" >"$candidate_env.next"
      chown root:ynx "$candidate_env.next"
      chmod 0640 "$candidate_env.next"
      mv "$candidate_env.next" "$candidate_env"
      systemctl restart ynx-bft-gateway-candidate.service
    else
      grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate gateway authorization is not transaction-owned"
    fi
    wait_gateway_ready false
  fi
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"authoritative","publicCutoverReady":false,"rolledBack":true,"recordedAt":"%s"}\n' \
    "$transaction_id" "$commit" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$rollback_evidence"
  chmod 0600 "$rollback_evidence"
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=false\ningress=authoritative\npublicCutoverReady=false\nrolledBack=true\n' "$transaction_id" "$commit" "$bft_release"
}

if [[ "$operation" == "rollback" ]]; then
  rollback_ingress
  exit 0
fi

[[ ${#files[@]} -gt 0 ]] || fail "no managed YNX ingress configuration exists"
if [[ -s "$rollback_evidence" ]]; then fail "rolled-back ingress transaction cannot be switched again"; fi
  if [[ -s "$switch_evidence" ]]; then
    owned "$switch_evidence" || fail "switch evidence belongs to another transaction"
    for file in "${files[@]}"; do
      ! grep -Eq '127\.0\.0\.1:64(20|26|27|28|29|30|31|32)' "$file" || fail "reused BFT ingress contains an authoritative target"
      grep -Eq '127\.0\.0\.1:276(20|26|27|28|29|30|31|32)' "$file" || fail "reused BFT ingress has no candidate target"
    done
  wait_gateway_ready true
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ningress=bft\npublicCutoverReady=true\n' "$transaction_id" "$commit" "$bft_release"
  exit 0
fi

owned "$dependency_ownership" || fail "transaction-owned candidate dependencies are required"
for service in ynx-bft-gateway-candidate.service ynx-bft-indexer-candidate.service ynx-bft-explorer-candidate.service ynx-bft-faucet-candidate.service ynx-bft-ai-candidate.service ynx-bft-pay-candidate.service ynx-bft-trust-candidate.service ynx-bft-resource-candidate.service; do
  systemctl is-active "$service" >/dev/null || fail "candidate dependency is not active: $service"
done
test -s "$candidate_env" || fail "candidate env is missing"
grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false' "$candidate_env" || fail "candidate gateway must start with public cutover authorization false"
systemctl is-active --quiet caddy || systemctl is-active --quiet nginx || fail "neither managed ingress service is active"

umask 077
install -d -m 0700 "$ingress_root/backups" "$ingress_root/candidates"
: >"$ingress_root/checksums.txt"
for file in "${files[@]}"; do
  name="$(backup_name "$file")"
  install -m 0600 "$file" "$ingress_root/backups/$name"
  printf '%s=%s\n' "$file" "$(sha256sum "$ingress_root/backups/$name" | awk '{print $1}')" >>"$ingress_root/checksums.txt"
  sed \
    -e 's#127\.0\.0\.1:6420#127.0.0.1:27620#g' \
    -e 's#127\.0\.0\.1:6426#127.0.0.1:27626#g' \
    -e 's#127\.0\.0\.1:6427#127.0.0.1:27627#g' \
    -e 's#127\.0\.0\.1:6428#127.0.0.1:27628#g' \
    -e 's#127\.0\.0\.1:6429#127.0.0.1:27629#g' \
    -e 's#127\.0\.0\.1:6430#127.0.0.1:27630#g' \
    -e 's#127\.0\.0\.1:6431#127.0.0.1:27631#g' \
    -e 's#127\.0\.0\.1:6432#127.0.0.1:27632#g' "$file" >"$ingress_root/candidates/$name"
  grep -Eq '127\.0\.0\.1:276(20|26|27|28|29|30|31|32)' "$ingress_root/candidates/$name" || fail "candidate ingress has no BFT targets: $file"
  ! grep -Eq '127\.0\.0\.1:64(20|26|27|28|29|30|31|32)' "$ingress_root/candidates/$name" || fail "candidate ingress retains authoritative YNX targets: $file"
done
chmod 0600 "$ingress_root/checksums.txt" "$ingress_root/candidates/"*
sha256sum "$ingress_root/candidates/"* >"$ingress_root/candidate-checksums.txt"
chmod 0600 "$ingress_root/candidate-checksums.txt"
authoritative_checksums_sha="$(sha256sum "$ingress_root/checksums.txt" | awk '{print $1}')"
candidate_checksums_sha="$(sha256sum "$ingress_root/candidate-checksums.txt" | awk '{print $1}')"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","files":%s,"authoritativeChecksumsSha256":"%s","candidateChecksumsSha256":"%s"}\n' "$transaction_id" "$commit" "$bft_release" "${#files[@]}" "$authoritative_checksums_sha" "$candidate_checksums_sha" >"$ownership"
chmod 0600 "$ownership"

switched=false
restore_on_error() {
  local status="$?"
  if [[ "$switched" != true ]]; then
    set +e
    restore_files
    if [[ -s "$candidate_env" ]]; then
      sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false/' "$candidate_env" >"$candidate_env.next"
      chown root:ynx "$candidate_env.next" && chmod 0640 "$candidate_env.next" && mv "$candidate_env.next" "$candidate_env"
      systemctl restart ynx-bft-gateway-candidate.service
    fi
  fi
  exit "$status"
}
trap restore_on_error EXIT

sed 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false$/YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true/' "$candidate_env" >"$candidate_env.next"
chown root:ynx "$candidate_env.next"
chmod 0640 "$candidate_env.next"
mv "$candidate_env.next" "$candidate_env"
systemctl restart ynx-bft-gateway-candidate.service
wait_gateway_ready true

for file in "${files[@]}"; do
  name="$(backup_name "$file")"
  install -m 0644 -o root -g root "$ingress_root/candidates/$name" "$file"
done
reload_active

printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","ingress":"bft","publicCutoverReady":true,"publicIngressChanged":true,"automaticRollbackRequired":true,"authoritativeChecksumsSha256":"%s","candidateChecksumsSha256":"%s","recordedAt":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$authoritative_checksums_sha" "$candidate_checksums_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$switch_evidence"
chmod 0600 "$switch_evidence"
switched=true
trap - EXIT
printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\ningress=bft\npublicCutoverReady=true\npublicIngressChanged=true\nautomaticRollbackRequired=true\n' "$transaction_id" "$commit" "$bft_release"
