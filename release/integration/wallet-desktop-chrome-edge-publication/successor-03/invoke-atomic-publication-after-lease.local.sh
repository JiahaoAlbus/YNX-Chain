#!/usr/bin/env bash
set -euo pipefail

request_id='P0-WALLET-CHROME-ZIP-PUBLICATION-20260823-03'
relative_root='release/integration/wallet-desktop-chrome-edge-publication/successor-03'

if [[ "${1:-}" == --self-test ]]; then
  repo_root="${YNX_LEASE_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
  remote_script="$repo_root/$relative_root/atomic-publication-after-lease.remote.sh"
  if (( BASH_VERSINFO[0] >= 4 )); then
    bash "$remote_script" --self-test
  else
    docker run --rm -v "$repo_root:/repo:ro" ubuntu:24.04 bash "/repo/$relative_root/atomic-publication-after-lease.remote.sh" --self-test
  fi
  encoded_roundtrip="$(base64 < "$remote_script" | tr -d '\n')"
  test "$(printf '%s' "$encoded_roundtrip" | base64 -d | shasum -a 256 | awk '{print $1}')" = "$(shasum -a 256 "$remote_script" | awk '{print $1}')"
  set +e
  (exit 23) | true
  producer_case=("${PIPESTATUS[@]}")
  true | (exit 24)
  transport_case=("${PIPESTATUS[@]}")
  set -e
  test "${producer_case[0]}:${producer_case[1]}" = '23:0'
  test "${transport_case[0]}:${transport_case[1]}" = '0:24'
  printf 'atomic_transport_rc_capture_self_test=pass\n'
  exit 0
fi

: "${YNX_DOWNLOADS_SSH_IDENTITY:?Protected SSH identity path is required}"
: "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:?Central lease ID is required}"
: "${YNX_LEASE_REPO_ROOT:?Exact lease package repository root is required}"
[[ "$YNX_CENTRAL_SINGLE_USE_LEASE_ID" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]

artifact='/private/tmp/ynx-wallet-hosting-prod-base.2tWxO9/public/downloads/wallet-web/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d/ynx-wallet-chrome-edge-0.1.0.zip'
candidate="$YNX_LEASE_REPO_ROOT/$relative_root/downloads.ynxweb4.com.candidate.caddy"
remote_script="$YNX_LEASE_REPO_ROOT/$relative_root/atomic-publication-after-lease.remote.sh"

test "$(stat -f %z "$artifact")" = 471181
test "$(shasum -a 256 "$artifact" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
test "$(stat -f %z "$candidate")" = 1749
test "$(shasum -a 256 "$candidate" | awk '{print $1}')" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
test "$(shasum -a 256 "$remote_script" | awk '{print $1}')" = 'da61412f0cd16b723d6631fffc4d81e8aaeee6f7a42ddeb1a545fbb919268f72'

encoded_script="$(base64 < "$remote_script" | tr -d '\n')"
remote_command="decoded=\$(printf '%s' '$encoded_script' | base64 -d) || exit 77; exec sudo -n env YNX_CENTRAL_SINGLE_USE_LEASE_ID='$YNX_CENTRAL_SINGLE_USE_LEASE_ID' YNX_DOWNLOADS_PUBLICATION_EXECUTION_ACK='${request_id}:EXECUTE' /bin/bash -c \"\$decoded\""

set +e
{
  dd if="$artifact" bs=471181 count=1 status=none
  dd if="$candidate" bs=1749 count=1 status=none
} | gtimeout 300 ssh \
  -i "$YNX_DOWNLOADS_SSH_IDENTITY" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=5 \
  -o ServerAliveCountMax=4 \
  ubuntu@43.153.202.237 "$remote_command"
pipeline_rc=("${PIPESTATUS[@]}")
set -e

producer_rc="${pipeline_rc[0]}"
transport_rc="${pipeline_rc[1]}"
printf 'atomic_publication_rc producer=%s transport_remote=%s request=%s\n' "$producer_rc" "$transport_rc" "$request_id"
if [[ "$producer_rc" != 0 ]]; then exit 76; fi
exit "$transport_rc"
