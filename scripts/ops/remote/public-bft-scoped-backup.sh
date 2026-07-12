#!/usr/bin/env bash
set -Eeuo pipefail

transaction_id="${1:?transaction id is required}"
role="${2:?role is required}"
commit="${3:?commit is required}"
authoritative_release="${4:?authoritative release is required}"
bft_release="${5:?BFT release is required}"
root="${6:?backup root is required}"
include_indexer="${7:?indexer flag is required}"
source_root="${8:?source root is required}"

[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]
[[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ ]]
[[ "$commit" =~ ^[0-9a-f]{12}$ ]]
[[ "$authoritative_release" == "ynx-chain-${commit}" ]]
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]]
[[ "$include_indexer" == "true" || "$include_indexer" == "false" ]]
[[ "$root" == /* && "$root" != *..* && "$root" =~ ^/[A-Za-z0-9._/-]+$ ]]
[[ "$source_root" == /* && "$source_root" != *..* && "$source_root" =~ ^/[A-Za-z0-9._/-]+$ ]]

umask 077
archive="${root}/${role}.tar.gz"
partial="${root}/.${role}.tar.gz.partial"
evidence="${root}/${role}.json"
evidence_partial="${evidence}.partial"
install -d -m 0700 "$root"
test -d "$source_root/etc/ynx"
test -d "$source_root/var/lib/ynx-chain/testnet"
test -f "$source_root/etc/systemd/system/ynx-chaind.service"
if [[ "$include_indexer" == "true" ]]; then
  test -d "$source_root/var/lib/ynx-chain/indexer"
fi

validate_archive() {
  test -s "$archive"
  tar -tzf "$archive" >/dev/null
  while IFS= read -r entry; do
    case "$entry" in
      etc/ynx|etc/ynx/*|\
      etc/systemd/system/ynx-chaind.service|\
      etc/systemd/system/ynx-indexerd.service|\
      etc/systemd/system/ynx-explorerd.service|\
      etc/systemd/system/ynx-faucetd.service|\
      etc/systemd/system/ynx-ai-gatewayd.service|\
      etc/systemd/system/ynx-payd.service|\
      etc/systemd/system/ynx-trustd.service|\
      etc/systemd/system/ynx-resourced.service|\
      etc/nginx/conf.d/ynx-chain.conf|\
      etc/caddy/Caddyfile|etc/caddy/ynx-chain.caddy|\
      var/lib/ynx-chain/testnet|var/lib/ynx-chain/testnet/*|\
      var/lib/ynx-chain/indexer|var/lib/ynx-chain/indexer/*) ;;
      *) echo "unsafe scoped backup entry: $entry" >&2; exit 1 ;;
    esac
  done < <(tar -tzf "$archive")
}

reused=false
if [[ -e "$archive" || -e "$evidence" ]]; then
  test -s "$archive" && test -s "$evidence" || {
    echo "incomplete existing transaction backup" >&2
    exit 1
  }
  validate_archive
  grep -Fq "\"transactionId\":\"${transaction_id}\"" "$evidence"
  grep -Fq "\"role\":\"${role}\"" "$evidence"
  grep -Fq "\"commit\":\"${commit}\"" "$evidence"
  grep -Fq "\"bftRelease\":\"${bft_release}\"" "$evidence"
  saved_sha="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$evidence")"
  current_sha="$(sha256sum "$archive" | awk '{print $1}')"
  [[ "$saved_sha" == "$current_sha" ]]
  reused=true
else
  rm -f "$partial" "$evidence_partial"
  paths=(etc/ynx etc/systemd/system/ynx-chaind.service var/lib/ynx-chain/testnet)
  for path in \
    etc/systemd/system/ynx-indexerd.service \
    etc/systemd/system/ynx-explorerd.service \
    etc/systemd/system/ynx-faucetd.service \
    etc/systemd/system/ynx-ai-gatewayd.service \
    etc/systemd/system/ynx-payd.service \
    etc/systemd/system/ynx-trustd.service \
    etc/systemd/system/ynx-resourced.service \
    etc/nginx/conf.d/ynx-chain.conf \
    etc/caddy/Caddyfile \
    etc/caddy/ynx-chain.caddy; do
    [[ -e "$source_root/$path" ]] && paths+=("$path")
  done
  [[ "$include_indexer" == "true" ]] && paths+=(var/lib/ynx-chain/indexer)
  tar -C "$source_root" -czf "$partial" "${paths[@]}"
  tar -tzf "$partial" >/dev/null
  chmod 0600 "$partial"
  mv "$partial" "$archive"
  validate_archive
  current_sha="$(sha256sum "$archive" | awk '{print $1}')"
  printf '{"transactionId":"%s","role":"%s","commit":"%s","authoritativeRelease":"%s","bftRelease":"%s","archivePath":"%s","sha256":"%s","validated":true}\n' \
    "$transaction_id" "$role" "$commit" "$authoritative_release" "$bft_release" "$archive" "$current_sha" >"$evidence_partial"
  chmod 0600 "$evidence_partial"
  mv "$evidence_partial" "$evidence"
fi

printf 'transactionId=%s\nrole=%s\ncommit=%s\nauthoritativeRelease=%s\nbftRelease=%s\narchive=%s\nsha256=%s\nvalidated=true\nreused=%s\n' \
  "$transaction_id" "$role" "$commit" "$authoritative_release" "$bft_release" "$archive" "$current_sha" "$reused"
