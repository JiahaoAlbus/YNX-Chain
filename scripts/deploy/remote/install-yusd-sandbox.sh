#!/usr/bin/env bash
set -Eeuo pipefail

package_dir="${1:?package directory is required}"
release="${2:?release is required}"
source_commit="${3:?source commit is required}"

[[ "$release" =~ ^ynx-yusd-sandbox-[0-9a-f]{12}$ ]] || { echo "invalid YUSD Sandbox release"; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit"; exit 1; }
[[ -d "$package_dir" && ! -L "$package_dir" ]] || { echo "invalid package directory"; exit 1; }

cd "$package_dir"
sha256sum -c SHA256SUMS
test -x bin/ynx-yusd-sandboxd
test -f config/ynx-yusd-sandboxd.env
test -f systemd/ynx-yusd-sandboxd.service

service_was_active=0
service_was_enabled=0
if sudo -n systemctl is-active --quiet ynx-yusd-sandboxd.service; then
  service_was_active=1
fi
if sudo -n systemctl is-enabled --quiet ynx-yusd-sandboxd.service; then
  service_was_enabled=1
fi

backup="/var/backups/ynx-chain/$release"
sudo -n rm -rf "$backup"
sudo -n install -d -m 0700 -o root -g root "$backup"
for path in \
  /usr/local/bin/ynx-yusd-sandboxd \
  /etc/systemd/system/ynx-yusd-sandboxd.service \
  /etc/ynx/ynx-yusd-sandboxd.env \
  /var/lib/ynx-chain/yusd-sandbox/state.json
do
  name="$(basename "$path")"
  if sudo -n test -e "$path"; then
    sudo -n cp -p "$path" "$backup/$name"
  else
    sudo -n touch "$backup/$name.absent"
  fi
done

restore_path() {
  local destination="$1" name
  name="$(basename "$destination")"
  if sudo -n test -f "$backup/$name.absent"; then
    sudo -n rm -f "$destination"
  elif [[ "$destination" == "/usr/local/bin/ynx-yusd-sandboxd" ]]; then
    sudo -n install -m 0755 -o root -g root "$backup/$name" "${destination}.${release}.restore"
    sudo -n mv -f "${destination}.${release}.restore" "$destination"
  else
    sudo -n cp -p "$backup/$name" "$destination"
  fi
}

deployment_complete=0
env_new=""
health=""
snapshot=""
rollback() {
  local status="$?"
  trap - EXIT
  rm -f "${env_new:-}" "${health:-}" "${snapshot:-}"
  if [[ "$status" != "0" && "$deployment_complete" == "0" ]]; then
    set +e
    sudo -n systemctl stop ynx-yusd-sandboxd.service
    restore_path /usr/local/bin/ynx-yusd-sandboxd
    restore_path /etc/systemd/system/ynx-yusd-sandboxd.service
    restore_path /etc/ynx/ynx-yusd-sandboxd.env
    restore_path /var/lib/ynx-chain/yusd-sandbox/state.json
    sudo -n chown ynx:ynx /var/lib/ynx-chain/yusd-sandbox/state.json 2>/dev/null || true
    sudo -n systemctl daemon-reload
    if [[ "$service_was_enabled" == "1" ]]; then
      sudo -n systemctl enable ynx-yusd-sandboxd.service
    else
      sudo -n systemctl disable ynx-yusd-sandboxd.service
    fi
    if [[ "$service_was_active" == "1" ]]; then
      sudo -n systemctl restart ynx-yusd-sandboxd.service
    fi
    echo "scoped YUSD Sandbox deployment failed; previous binary, configuration and state restored" >&2
  fi
  exit "$status"
}
trap rollback EXIT

sudo -n install -d -m 0750 -o root -g ynx /etc/ynx
sudo -n install -d -m 0700 -o ynx -g ynx /var/lib/ynx-chain/yusd-sandbox
api_key=""
if sudo -n test -f /etc/ynx/ynx-yusd-sandboxd.env; then
  api_key="$(sudo -n sed -n 's/^YNX_YUSD_SANDBOX_API_KEY=//p' /etc/ynx/ynx-yusd-sandboxd.env | tail -1)"
fi
if [[ ! "$api_key" =~ ^[0-9a-f]{64}$ ]]; then
  api_key="$(openssl rand -hex 32)"
fi
env_new="$(mktemp)"
cp config/ynx-yusd-sandboxd.env "$env_new"
printf 'YNX_YUSD_SANDBOX_API_KEY=%s\n' "$api_key" >>"$env_new"

sudo -n install -m 0755 -o root -g root bin/ynx-yusd-sandboxd "/usr/local/bin/ynx-yusd-sandboxd.${release}.new"
sudo -n mv -f "/usr/local/bin/ynx-yusd-sandboxd.${release}.new" /usr/local/bin/ynx-yusd-sandboxd
sudo -n install -m 0644 -o root -g root systemd/ynx-yusd-sandboxd.service /etc/systemd/system/ynx-yusd-sandboxd.service
sudo -n install -m 0640 -o root -g ynx "$env_new" /etc/ynx/ynx-yusd-sandboxd.env
rm -f "$env_new"
env_new=""
sudo -n bash -lc 'set -a; source /etc/ynx/ynx-yusd-sandboxd.env; set +a; /usr/local/bin/ynx-yusd-sandboxd --check-config >/dev/null'
sudo -n systemctl daemon-reload
sudo -n systemctl enable ynx-yusd-sandboxd.service
sudo -n systemctl restart ynx-yusd-sandboxd.service
sudo -n systemctl is-active --quiet ynx-yusd-sandboxd.service

health="$(mktemp)"
snapshot="$(mktemp)"
ready=0
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 5 http://127.0.0.1:6490/health >"$health" &&
    grep -Fq '"service":"ynx-yusd-sandboxd"' "$health" &&
    grep -Fq "\"commit\":\"$source_commit\"" "$health" &&
    grep -Fq '"testnetOnly":true' "$health" &&
    grep -Fq '"realityValue":false' "$health"; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "YUSD Sandbox did not report truthful release health"; exit 1; }

suffix="${source_commit:0:12}"
evidence="$(printf '%s' "$release-real-testnet-cycle" | sha256sum | awk '{print $1}')"
account="0x5955534453414e44424f58544553544e45543031"
auth=(-H "X-YNX-YUSD-Sandbox-Key: $api_key" -H 'Content-Type: application/json')
curl -fsS -X POST http://127.0.0.1:6490/yusd/provider-status "${auth[@]}" \
  -d "{\"idempotencyKey\":\"provider-$suffix\",\"status\":\"available\",\"evidenceHash\":\"$evidence\"}" >/dev/null
curl -fsS -X POST http://127.0.0.1:6490/yusd/pause "${auth[@]}" \
  -d "{\"idempotencyKey\":\"unpause-$suffix\",\"paused\":false,\"evidenceHash\":\"$evidence\"}" >/dev/null
curl -fsS -X POST http://127.0.0.1:6490/yusd/reserve-deposits "${auth[@]}" \
  -d "{\"idempotencyKey\":\"reserve-$suffix\",\"amount\":5000000,\"evidenceHash\":\"$evidence\"}" >/dev/null
curl -fsS -X POST http://127.0.0.1:6490/yusd/mint "${auth[@]}" \
  -d "{\"idempotencyKey\":\"mint-$suffix\",\"amount\":1000000,\"account\":\"$account\",\"evidenceHash\":\"$evidence\"}" >/dev/null
redemption="$(curl -fsS -X POST http://127.0.0.1:6490/yusd/redemptions "${auth[@]}" \
  -d "{\"idempotencyKey\":\"redeem-$suffix\",\"amount\":400000,\"account\":\"$account\",\"evidenceHash\":\"$evidence\"}")"
redemption_id="$(printf '%s' "$redemption" | sed -n 's/.*"id":"\(yred_[0-9a-f]\{24\}\)".*/\1/p')"
[[ "$redemption_id" =~ ^yred_[0-9a-f]{24}$ ]] || { echo "YUSD Sandbox redemption did not return a canonical ID"; exit 1; }
curl -fsS -X POST "http://127.0.0.1:6490/yusd/redemptions/$redemption_id/fulfill" "${auth[@]}" \
  -d "{\"idempotencyKey\":\"fulfill-$suffix\",\"amount\":400000,\"evidenceHash\":\"$evidence\"}" |
  grep -Fq '"status":"completed"'
curl -fsS --max-time 5 http://127.0.0.1:6490/yusd/snapshot >"$snapshot"
grep -Fq '"solvent":true' "$snapshot"
grep -Fq '"reconciled":true' "$snapshot"
grep -Fq '"pendingRedemptionUnits":0' "$snapshot"
grep -Fq '"realityValue":false' "$snapshot"

rm -f "$health" "$snapshot"
health=""
snapshot=""
deployment_complete=1
trap - EXIT
echo "scoped YUSD Sandbox deployment verified: release=$release sourceCommit=$source_commit realTestnetCycle=reserve-mint-redeem-fulfill realityValue=false"
