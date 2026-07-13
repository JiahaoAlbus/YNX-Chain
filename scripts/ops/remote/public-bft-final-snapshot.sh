#!/usr/bin/env bash
set -Eeuo pipefail

transaction_id="${1:?transaction id is required}"
commit="${2:?commit is required}"
authoritative_release="${3:?authoritative release is required}"
bft_release="${4:?BFT release is required}"
pause_marker="${5:?pause marker is required}"
mutation_marker="${6:?mutation marker is required}"
evidence_root="${7:?evidence root is required}"
chain_url="${8:?chain URL is required}"
config_root="${9:?config root is required}"
chaind_binary="${10:?ynx-chaind binary is required}"
observation="${11:-2}"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$authoritative_release" == "ynx-chain-${commit}" ]] || fail "authoritative release mismatch"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 1 && observation <= 15 )) || fail "invalid final snapshot observation window"
for path in "$pause_marker" "$mutation_marker" "$evidence_root" "$config_root" "$chaind_binary"; do
  [[ "$path" == /* && "$path" != *..* && "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid final snapshot path"
done
[[ "$chain_url" =~ ^http://127\.0\.0\.1:[0-9]{4,5}$ ]] || fail "invalid chain probe URL"
test -x "$chaind_binary" || fail "ynx-chaind export binary is unavailable"

marker_matches() {
  local marker="$1"
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$marker" &&
    grep -Fq "\"commit\":\"${commit}\"" "$marker" &&
    grep -Fq "\"bftRelease\":\"${bft_release}\"" "$marker"
}

test -s "$pause_marker" && marker_matches "$pause_marker" || fail "transaction-bound production pause marker is required"
test -s "$mutation_marker" && marker_matches "$mutation_marker" || fail "transaction-bound mutation freeze marker is required"
pause_evidence="$evidence_root/primary-pause-authoritative.json"
test -s "$pause_evidence" || fail "validated authoritative pause evidence is required"
grep -Fq '"productionStateVerified":true' "$pause_evidence" || fail "authoritative pause evidence is not validated"

status_fields() {
  local payload height block_hash
  payload="$(curl -fsS "$chain_url/status")" || fail "authoritative status probe failed"
  height="$(printf '%s' "$payload" | sed -n 's/.*"height":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
  block_hash="$(printf '%s' "$payload" | sed -n 's/.*"latestBlockHash":"\([^"]*\)".*/\1/p' | head -1)"
  [[ "$height" =~ ^[0-9]+$ && "$block_hash" =~ ^(0x)?[0-9a-fA-F]{64}$ ]] || fail "authoritative status boundary is invalid"
  printf '%s %s' "$height" "$block_hash"
}

read -r status_height status_hash <<<"$(status_fields)"
sleep "$observation"
read -r stable_height stable_hash <<<"$(status_fields)"
[[ "$stable_height" == "$status_height" && "$stable_hash" == "$status_hash" ]] || fail "authoritative boundary changed during final snapshot preflight"

umask 077
install -d -m 0700 "$evidence_root"
snapshot="$evidence_root/final-migration-state.json"
metadata="$evidence_root/final-migration-state.evidence.json"
partial="${snapshot}.partial-${transaction_id}"
metadata_partial="${metadata}.partial"
trap 'rm -f "$partial" "$metadata_partial"' EXIT

reused=false
if [[ -s "$snapshot" && -s "$metadata" ]]; then
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$metadata" || fail "existing final snapshot transaction mismatch"
  grep -Fq "\"commit\":\"${commit}\"" "$metadata" || fail "existing final snapshot commit mismatch"
  saved_sha="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$metadata")"
  current_sha="$(sha256sum "$snapshot" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$snapshot" | awk '{print $1}')"
  [[ -n "$saved_sha" && "$saved_sha" == "$current_sha" ]] || fail "existing final snapshot checksum mismatch"
  reused=true
else
  shared_env="$config_root/etc/ynx/ynx-chaind.env"
  test -f "$shared_env" || fail "missing authoritative chain environment"
  set -a
  # shellcheck disable=SC1090
  source "$shared_env"
  set +a
  "$chaind_binary" --export-consensus-state "$partial" >/dev/null
  chmod 0600 "$partial"
  mv "$partial" "$snapshot"
fi

snapshot_height="$(sed -n 's/.*"height":\([0-9][0-9]*\).*/\1/p' "$snapshot" | head -1)"
snapshot_hash="$(sed -n 's/.*"lastBlockHash":"\([^"]*\)".*/\1/p' "$snapshot" | head -1)"
state_hash="$(sed -n 's/.*"stateHash":"\([0-9a-f]\{64\}\)".*/\1/p' "$snapshot" | head -1)"
[[ "$snapshot_height" == "$stable_height" ]] || fail "final snapshot height does not match paused authoritative height"
[[ "$snapshot_hash" == "$stable_hash" ]] || fail "final snapshot block hash does not match paused authoritative hash"
[[ "$state_hash" =~ ^[0-9a-f]{64}$ ]] || fail "final snapshot state hash is invalid"
snapshot_sha="$(sha256sum "$snapshot" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$snapshot" | awk '{print $1}')"

printf '{"transactionId":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","height":%s,"lastBlockHash":"%s","stateHash":"%s","sha256":"%s","pauseVerified":true,"mutationFreezeVerified":true,"validated":true,"reused":%s,"recordedAt":"%s"}\n' \
  "$transaction_id" "$commit" "$authoritative_release" "$bft_release" "$snapshot_height" "$snapshot_hash" "$state_hash" "$snapshot_sha" "$reused" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$metadata_partial"
chmod 0600 "$metadata_partial"
mv "$metadata_partial" "$metadata"
trap - EXIT

printf 'transactionId=%s\ncommit=%s\nauthoritativeRelease=%s\nbftRelease=%s\nheight=%s\nlastBlockHash=%s\nstateHash=%s\nsha256=%s\npauseVerified=true\nmutationFreezeVerified=true\nvalidated=true\nreused=%s\n' \
  "$transaction_id" "$commit" "$authoritative_release" "$bft_release" "$snapshot_height" "$snapshot_hash" "$state_hash" "$snapshot_sha" "$reused"
