#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?operation is required}"
transaction_id="${2:?transaction id is required}"
role="${3:?role is required}"
commit="${4:?commit is required}"
authoritative_release="${5:?authoritative release is required}"
bft_release="${6:?BFT release is required}"
marker="${7:?marker path is required}"
evidence_root="${8:?evidence root is required}"
chain_url="${9:?chain URL is required}"
mutation_urls="${10:?mutation URLs are required}"
config_root="${11:?config root is required}"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "$operation" == "freeze" || "$operation" == "unfreeze" ]] || fail "invalid mutation freeze operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ ]] || fail "invalid role"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$authoritative_release" == "ynx-chain-${commit}" ]] || fail "authoritative release mismatch"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
for path in "$marker" "$evidence_root"; do
  [[ "$path" == /* && "$path" != *..* && "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid mutation freeze path"
done
[[ "$config_root" == /* && "$config_root" != *..* && "$config_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid config root"
[[ "$chain_url" =~ ^http://127\.0\.0\.1:[0-9]{4,5}$ ]] || fail "invalid chain probe URL"
IFS=, read -r -a mutation_url_list <<<"$mutation_urls"
(( ${#mutation_url_list[@]} >= 1 && ${#mutation_url_list[@]} <= 8 )) || fail "invalid mutation probe count"
for url in "${mutation_url_list[@]}"; do
  [[ "$url" =~ ^http://127\.0\.0\.1:[0-9]{4,5}$ ]] || fail "invalid mutation probe URL"
done

umask 077
install -d -m 0750 "$(dirname "$marker")" || fail "cannot create mutation marker directory"
install -d -m 0700 "$evidence_root" || fail "cannot create mutation evidence directory"
evidence="$evidence_root/${role}-${operation}.json"
evidence_partial="${evidence}.partial"
marker_partial="${marker}.partial-${transaction_id}"

shared_env="etc/ynx/ynx-chaind.env"
service_units=(etc/systemd/system/ynx-chaind.service)
if [[ "$role" == "primary" ]]; then
  service_units+=(
    etc/systemd/system/ynx-faucetd.service
    etc/systemd/system/ynx-ai-gatewayd.service
    etc/systemd/system/ynx-payd.service
    etc/systemd/system/ynx-trustd.service
    etc/systemd/system/ynx-resourced.service
  )
fi
test -f "$config_root/$shared_env" || fail "missing shared mutation freeze environment"
grep -Fqx "YNX_MUTATION_FREEZE_FILE=$marker" "$config_root/$shared_env" || fail "shared environment does not use the approved mutation marker"
for service_unit in "${service_units[@]}"; do
  test -f "$config_root/$service_unit" || fail "missing mutation-protected service unit: $service_unit"
  grep -Fqx 'EnvironmentFile=/etc/ynx/ynx-chaind.env' "$config_root/$service_unit" || fail "service does not load the shared mutation environment: $service_unit"
done

marker_matches_transaction() {
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$marker" &&
    grep -Fq "\"commit\":\"${commit}\"" "$marker" &&
    grep -Fq "\"bftRelease\":\"${bft_release}\"" "$marker"
}

reused=false
if [[ "$operation" == "freeze" ]]; then
  backup_archive="$evidence_root/${role}.tar.gz"
  backup_evidence="$evidence_root/${role}.json"
  test -s "$backup_archive" && test -s "$backup_evidence" || fail "missing transaction-bound remote backup"
  tar -tzf "$backup_archive" >/dev/null || fail "remote backup archive is unreadable"
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$backup_evidence" || fail "backup transaction mismatch"
  grep -Fq "\"role\":\"${role}\"" "$backup_evidence" || fail "backup role mismatch"
  grep -Fq "\"commit\":\"${commit}\"" "$backup_evidence" || fail "backup commit mismatch"
  grep -Fq "\"bftRelease\":\"${bft_release}\"" "$backup_evidence" || fail "backup BFT release mismatch"
  grep -Fq '"validated":true' "$backup_evidence" || fail "backup is not validated"
  backup_saved_sha="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$backup_evidence")"
  backup_current_sha="$(sha256sum "$backup_archive" | awk '{print $1}')"
  [[ -n "$backup_saved_sha" && "$backup_saved_sha" == "$backup_current_sha" ]] || fail "backup checksum mismatch"
  if [[ -e "$marker" ]]; then
    marker_matches_transaction || {
      echo "mutation freeze marker belongs to another transaction" >&2
      exit 1
    }
    reused=true
  else
    printf '{"transactionId":"%s","role":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","frozenAt":"%s"}\n' \
      "$transaction_id" "$role" "$commit" "$authoritative_release" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker_partial"
    chmod 0600 "$marker_partial" || fail "cannot restrict mutation marker"
    mv "$marker_partial" "$marker" || fail "cannot publish mutation marker"
  fi
  marker_sha="$(sha256sum "$marker" | awk '{print $1}')"
else
  marker_sha=""
  if [[ -e "$marker" ]]; then
    marker_matches_transaction || {
      echo "refusing to remove another transaction's mutation freeze marker" >&2
      exit 1
    }
    marker_sha="$(sha256sum "$marker" | awk '{print $1}')"
    rm -f "$marker"
  else
    reused=true
  fi
fi

probe_dir="$(mktemp -d)"
trap 'rm -rf "$probe_dir" "$marker_partial" "$evidence_partial"' EXIT
status_code="$(curl -sS -o "$probe_dir/status" -w '%{http_code}' "$chain_url/status")" || fail "chain status probe failed"
[[ "$status_code" == "200" ]] || fail "chain status read failed during mutation transition"
evm_code="$(curl -sS -o "$probe_dir/evm" -w '%{http_code}' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$chain_url/evm")" || fail "EVM read probe failed"
[[ "$evm_code" == "200" ]] || fail "EVM read was unavailable during mutation transition"
for url in "${mutation_url_list[@]}"; do
  probe_code="$(curl -sS -o "$probe_dir/mutation" -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' "$url/__ynx_mutation_freeze_probe__")" || fail "mutation probe failed: $url"
  if [[ "$operation" == "freeze" ]]; then
    [[ "$probe_code" == "503" ]] || fail "mutation endpoint did not freeze: $url"
    grep -Fq '"status":"mutation_frozen"' "$probe_dir/mutation" || fail "mutation endpoint returned invalid freeze evidence: $url"
  else
    [[ "$probe_code" != "503" ]] || fail "mutation endpoint remained frozen: $url"
  fi
done

printf '{"transactionId":"%s","role":"%s","operation":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","markerPath":"%s","markerSha256":"%s","readStatus":200,"readEvm":200,"mutationStateVerified":true,"reused":%s,"recordedAt":"%s"}\n' \
  "$transaction_id" "$role" "$operation" "$commit" "$authoritative_release" "$bft_release" "$marker" "$marker_sha" "$reused" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_partial"
chmod 0600 "$evidence_partial" || fail "cannot restrict mutation evidence"
mv "$evidence_partial" "$evidence" || fail "cannot publish mutation evidence"
trap - EXIT
rm -rf "$probe_dir" "$marker_partial"

printf 'transactionId=%s\nrole=%s\noperation=%s\ncommit=%s\nauthoritativeRelease=%s\nbftRelease=%s\nmarker=%s\nmarkerSha256=%s\nreadStatus=200\nreadEvm=200\nmutationStateVerified=true\nreused=%s\n' \
  "$transaction_id" "$role" "$operation" "$commit" "$authoritative_release" "$bft_release" "$marker" "$marker_sha" "$reused"
