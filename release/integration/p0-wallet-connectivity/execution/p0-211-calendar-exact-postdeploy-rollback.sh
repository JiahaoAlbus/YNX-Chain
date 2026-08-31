#!/usr/bin/env bash
set -Eeuo pipefail

backup=/var/backups/ynx-chain/calendar-468cf018-revoke-p0211-20260822T191500Z
binary=/usr/local/bin/ynx-calendard
state=/var/lib/ynx-chain/calendar/state.json
state_key=/var/lib/ynx-chain/calendar/state.json.hmac-key
service=ynx-calendar.service

test "$(sha256sum "$backup/ynx-calendard" | cut -c1-64)" = fb767da23513d3c4ba7eab9e02ddf6088b3bea297e6e42ac33bbcd0fa7db7c73
test "$(sha256sum "$backup/state.json" | cut -c1-64)" = fbe1c9cf058658370373385dc659c8b43a14238a3adef9df62a8b5ef0d22bd9c
test "$(sha256sum "$backup/state.json.hmac-key" | cut -c1-64)" = bf7b567201cab33c4b9ed02e00f0d0165172b4e692484ca044d828d0a3fb5e62

systemctl stop "$service"
install -o root -g root -m 0755 "$backup/ynx-calendard" "$binary"
install -o ynx -g ynx -m 0600 "$backup/state.json" "$state"
install -o ynx -g ynx -m 0600 "$backup/state.json.hmac-key" "$state_key"
test "$(sha256sum "$binary" | cut -c1-64)" = fb767da23513d3c4ba7eab9e02ddf6088b3bea297e6e42ac33bbcd0fa7db7c73
test "$(sha256sum "$state" | cut -c1-64)" = fbe1c9cf058658370373385dc659c8b43a14238a3adef9df62a8b5ef0d22bd9c
test "$(sha256sum "$state_key" | cut -c1-64)" = bf7b567201cab33c4b9ed02e00f0d0165172b4e692484ca044d828d0a3fb5e62
systemctl reset-failed "$service" || true
systemctl start "$service"

for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:18097/v1/health | grep -Fq fe1ba512f67f935e27997350800a7df18e3814d1; then
    exit 0
  fi
  sleep 1
done
exit 1
