#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?operation is required}"
transaction_id="${2:?transaction id is required}"
commit="${3:?commit is required}"
authoritative_release="${4:?authoritative release is required}"
bft_release="${5:?BFT release is required}"
pause_marker="${6:?pause marker is required}"
mutation_marker="${7:?mutation marker is required}"
evidence_root="${8:?evidence root is required}"
chain_url="${9:?chain URL is required}"
config_root="${10:?config root is required}"
observation="${11:-4}"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "$operation" == "pause" || "$operation" == "resume" ]] || fail "invalid authoritative production operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$authoritative_release" == "ynx-chain-${commit}" ]] || fail "authoritative release mismatch"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$observation" =~ ^[0-9]+$ ]] && (( observation >= 1 && observation <= 15 )) || fail "invalid production observation window"
for path in "$pause_marker" "$mutation_marker" "$evidence_root" "$config_root"; do
  [[ "$path" == /* && "$path" != *..* && "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid authoritative pause path"
done
[[ "$chain_url" =~ ^http://127\.0\.0\.1:[0-9]{4,5}$ ]] || fail "invalid chain probe URL"

shared_env="$config_root/etc/ynx/ynx-chaind.env"
test -f "$shared_env" || fail "missing authoritative chain environment"
grep -Fqx "YNX_BLOCK_PRODUCTION_PAUSE_FILE=$pause_marker" "$shared_env" || fail "chain environment does not use the approved production pause marker"
if [[ "$config_root" == "/" ]]; then
  systemctl is-active ynx-chaind.service >/dev/null || fail "authoritative chain service is not active"
fi

marker_matches_transaction() {
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$pause_marker" &&
    grep -Fq "\"commit\":\"${commit}\"" "$pause_marker" &&
    grep -Fq "\"bftRelease\":\"${bft_release}\"" "$pause_marker"
}

status_height() {
  local payload height
  payload="$(curl -fsS "$chain_url/status")" || fail "authoritative status probe failed"
  height="$(printf '%s' "$payload" | sed -n 's/.*"height":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
  [[ "$height" =~ ^[0-9]+$ ]] || fail "authoritative status height is invalid"
  printf '%s' "$height"
}

umask 077
install -d -m 0750 "$(dirname "$pause_marker")" || fail "cannot create production pause marker directory"
install -d -m 0700 "$evidence_root" || fail "cannot create production pause evidence directory"
evidence="$evidence_root/primary-${operation}-authoritative.json"
partial="${evidence}.partial"
marker_partial="${pause_marker}.partial-${transaction_id}"
trap 'rm -f "$partial" "$marker_partial"' EXIT

reused=false
if [[ "$operation" == "pause" ]]; then
  test -s "$mutation_marker" || fail "mutation freeze marker is required before authoritative pause"
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$mutation_marker" || fail "mutation marker transaction mismatch"
  grep -Fq "\"commit\":\"${commit}\"" "$mutation_marker" || fail "mutation marker commit mismatch"
  freeze_evidence="$evidence_root/primary-freeze.json"
  test -s "$freeze_evidence" || fail "validated primary freeze evidence is required"
  grep -Fq '"mutationStateVerified":true' "$freeze_evidence" || fail "primary freeze evidence is not validated"
  if [[ -e "$pause_marker" ]]; then
    marker_matches_transaction || fail "production pause marker belongs to another transaction"
    reused=true
  else
    printf '{"transactionId":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","pausedAt":"%s"}\n' \
      "$transaction_id" "$commit" "$authoritative_release" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker_partial"
    chmod 0600 "$marker_partial"
    mv "$marker_partial" "$pause_marker"
  fi
  test "$(stat -c '%a' "$pause_marker" 2>/dev/null || stat -f '%Lp' "$pause_marker")" = 600 || fail "production pause marker mode is not 0600"
  sleep "$observation"
  height_before="$(status_height)"
  sleep "$observation"
  height_after="$(status_height)"
  [[ "$height_after" == "$height_before" ]] || fail "authoritative height advanced while production pause marker was active"
  marker_sha="$(sha256sum "$pause_marker" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$pause_marker" | awk '{print $1}')"
else
  marker_sha=""
  if [[ -e "$pause_marker" ]]; then
    marker_matches_transaction || fail "refusing to remove another transaction's production pause marker"
    marker_sha="$(sha256sum "$pause_marker" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$pause_marker" | awk '{print $1}')"
    rm -f "$pause_marker"
  else
    reused=true
  fi
  height_before="$(status_height)"
  sleep "$observation"
  height_after="$(status_height)"
  (( height_after > height_before )) || fail "authoritative height did not resume after production pause removal"
fi

printf '{"transactionId":"%s","operation":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","pauseMarker":"%s","markerSha256":"%s","heightBefore":%s,"heightAfter":%s,"readsOnline":true,"productionStateVerified":true,"reused":%s,"recordedAt":"%s"}\n' \
  "$transaction_id" "$operation" "$commit" "$authoritative_release" "$bft_release" "$pause_marker" "$marker_sha" "$height_before" "$height_after" "$reused" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$partial"
chmod 0600 "$partial"
mv "$partial" "$evidence"
trap - EXIT
rm -f "$marker_partial"

printf 'transactionId=%s\noperation=%s\ncommit=%s\nauthoritativeRelease=%s\nbftRelease=%s\npauseMarker=%s\nmarkerSha256=%s\nheightBefore=%s\nheightAfter=%s\nreadsOnline=true\nproductionStateVerified=true\nreused=%s\n' \
  "$transaction_id" "$operation" "$commit" "$authoritative_release" "$bft_release" "$pause_marker" "$marker_sha" "$height_before" "$height_after" "$reused"
