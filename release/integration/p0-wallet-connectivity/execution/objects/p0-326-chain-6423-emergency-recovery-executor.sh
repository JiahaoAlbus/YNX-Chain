#!/usr/bin/env bash
set -Eeuo pipefail

signed_input="${1:?signed input path required}"
signed_sha="${2:?signed input SHA-256 required}"
candidate="${3:?candidate Caddy path required}"
candidate_sha="${4:?candidate Caddy SHA-256 required}"
stdout_path="${5:?stdout path required}"
stderr_path="${6:?stderr path required}"
receipt_path="${7:?receipt path required}"
ack="${8:?execution acknowledgement required}"

fail() { printf '%s\n' "$1" >&2; exit 65; }
sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }

[[ "$ack" == "P0-326:EXECUTE_CHAIN_6423_EMERGENCY_RECOVERY_ONCE" ]] || fail "ACK_MISMATCH"
[[ -f "$signed_input" && ! -L "$signed_input" ]] || fail "SIGNED_INPUT_INVALID"
[[ -f "$candidate" && ! -L "$candidate" ]] || fail "CANDIDATE_INVALID"
[[ "$(sha256 "$signed_input")" == "$signed_sha" ]] || fail "SIGNED_INPUT_SHA_MISMATCH"
[[ "$(sha256 "$candidate")" == "$candidate_sha" ]] || fail "CANDIDATE_SHA_MISMATCH"
[[ "$(/usr/bin/jq -r '.ack' "$signed_input")" == "$ack" ]] || fail "SIGNED_ACK_MISMATCH"
[[ "$(/usr/bin/jq -r '.primary.candidateSha256' "$signed_input")" == "$candidate_sha" ]] || fail "SIGNED_CANDIDATE_MISMATCH"
for path in "$stdout_path" "$stderr_path" "$receipt_path"; do [[ ! -e "$path" && ! -L "$path" ]] || fail "LOCAL_OUTPUT_PREEXISTS:$path"; done

for name in YNX_PRIMARY_SSH_IDENTITY; do
  value="${!name:-}"
  [[ -n "$value" && -f "$value" && ! -L "$value" && -r "$value" ]] || fail "PROTECTED_IDENTITY_UNAVAILABLE:$name"
done

signed_b64="$(/usr/bin/base64 < "$signed_input" | /usr/bin/tr -d '\n')"
candidate_b64="$(/usr/bin/base64 < "$candidate" | /usr/bin/tr -d '\n')"
known_hosts="/Users/huangjiahao/.ssh/known_hosts"
ssh_common=(-o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" -o ConnectTimeout=10 -o ConnectionAttempts=1)

run_primary() {
  /usr/bin/ssh -i "$YNX_PRIMARY_SSH_IDENTITY" "${ssh_common[@]}" ubuntu@43.153.202.237 sudo -n /bin/bash -s -- "$signed_b64" "$candidate_b64" <<'REMOTE'
set -Eeuo pipefail
signed_json="$(printf '%s' "$1" | base64 -d)"
candidate_b64="$2"
live=/etc/caddy/ynx-chain.caddy
recovery=/var/lib/ynx-chain/emergency-recovery/p0-326-chain-6423
pending=/etc/caddy/.ynx-chain.caddy.p0-326.pending
backup="$recovery/ynx-chain.caddy.rollback"
public_ok=false
fail() { printf '%s\n' "$1" >&2; exit 65; }
tuple() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha() { sha256sum "$1" | awk '{print $1}'; }
restore_before_public() {
  status=$?
  if [[ "$public_ok" != true && -f "$backup" && ! -L "$backup" ]]; then
    install -m 0644 -o root -g root "$backup" "$live" || true
    caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy.service || true
  fi
  rm -f "$pending" 2>/dev/null || true
  exit "$status"
}
trap restore_before_public EXIT

expected_tuple="$(jq -r '.primary.caddyConfigTuple' <<<"$signed_json")"
expected_sha="$(jq -r '.primary.caddyConfigSha256' <<<"$signed_json")"
[[ -f "$live" && ! -L "$live" && "$(tuple "$live")" == "$expected_tuple" && "$(sha "$live")" == "$expected_sha" ]] || fail CADDY_PREWRITE_DRIFT
[[ "$(systemctl show caddy.service -p MainPID --value)" == "$(jq -r '.primary.caddyMainPid' <<<"$signed_json")" ]] || fail CADDY_PID_DRIFT
[[ "$(systemctl show caddy.service -p NRestarts --value)" == "$(jq -r '.primary.caddyNRestarts' <<<"$signed_json")" ]] || fail CADDY_RESTART_DRIFT
[[ ! -e "$recovery" && ! -L "$recovery" && ! -e "$pending" && ! -L "$pending" ]] || fail RECOVERY_PATH_PREEXISTS

while IFS=$'\t' read -r unit pid restarts unit_sha; do
  [[ "$(systemctl is-active "$unit")" == active ]] || fail "NEW_SERVICE_INACTIVE:$unit"
  [[ "$(systemctl show "$unit" -p MainPID --value)" == "$pid" ]] || fail "NEW_SERVICE_PID_DRIFT:$unit"
  [[ "$(systemctl show "$unit" -p NRestarts --value)" == "$restarts" ]] || fail "NEW_SERVICE_RESTART_DRIFT:$unit"
  fragment="$(systemctl show "$unit" -p FragmentPath --value)"
  [[ -f "$fragment" && ! -L "$fragment" && "$(sha "$fragment")" == "$unit_sha" ]] || fail "NEW_UNIT_DRIFT:$unit"
done < <(jq -r '.primary.newServices[]|[.unit,(.pid|tostring),(.nRestarts|tostring),.unitSha256]|@tsv' <<<"$signed_json")

while IFS=$'\t' read -r unit pid unit_sha; do
  [[ "$(systemctl is-active "$unit")" == active && "$(systemctl is-enabled "$unit")" == enabled ]] || fail "LEGACY_SERVICE_STATE_DRIFT:$unit"
  [[ "$(systemctl show "$unit" -p MainPID --value)" == "$pid" ]] || fail "LEGACY_SERVICE_PID_DRIFT:$unit"
  fragment="$(systemctl show "$unit" -p FragmentPath --value)"
  [[ "$fragment" == "/etc/systemd/system/$unit" && -f "$fragment" && ! -L "$fragment" && "$(sha "$fragment")" == "$unit_sha" ]] || fail "LEGACY_UNIT_DRIFT:$unit"
done < <(jq -r '.primary.legacyServices[]|[.unit,(.pid|tostring),.unitSha256]|@tsv' <<<"$signed_json")

curl -fsS --max-time 5 http://127.0.0.1:6420/status | jq -e '.chainId==6423 and .catchingUp==false' >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:6426/health | jq -e '.ok==true and .chainId==6423' >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:6427/health | jq -e '.ok==true and .network.chainId==6423 and .wallet.chainIdHex=="0x1917"' >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:6428/health | jq -e '.ok==true and .chainId==6423' >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:6429/health | jq -e '.ok==true and .chainId==6423' >/dev/null

install -d -m 0700 -o root -g root "$recovery" "$recovery/primary-units"
install -m 0600 -o root -g root "$live" "$backup"
[[ "$(sha "$backup")" == "$expected_sha" ]] || fail CADDY_BACKUP_SHA_MISMATCH
umask 077
printf '%s' "$candidate_b64" | base64 -d > "$pending"
chown root:root "$pending"
chmod 0600 "$pending"
[[ "$(wc -c < "$pending" | tr -d ' ')" == "$(jq -r '.primary.candidateBytes' <<<"$signed_json")" && "$(sha "$pending")" == "$(jq -r '.primary.candidateSha256' <<<"$signed_json")" ]] || fail CANDIDATE_MATERIALIZATION_MISMATCH
! grep -Eq 'ynx_9102-1|0x238e|127\.0\.0\.1:(36657|3854[56]|3808[0-9]|3809[01]|39090|31317)' "$pending" || fail LEGACY_ROUTE_GATE_FAILED
caddy validate --config "$pending" --adapter caddyfile >/dev/null
chmod 0644 "$pending"
mv -T "$pending" "$live"
[[ "$(sha "$live")" == "$(jq -r '.primary.candidateSha256' <<<"$signed_json")" ]] || fail LIVE_CANDIDATE_SHA_MISMATCH
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy.service
[[ "$(systemctl is-active caddy.service)" == active ]] || fail CADDY_RELOAD_FAILED

curl -fsS --max-time 10 https://rpc.ynxweb4.com/status | jq -e '.chainId==6423 and .catchingUp==false' >/dev/null
curl -fsS --max-time 10 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://evm.ynxweb4.com | jq -e '.result=="0x1917"' >/dev/null
curl -fsS --max-time 10 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"net_version","params":[]}' https://evm.ynxweb4.com | jq -e '.result=="6423"' >/dev/null
curl -fsS --max-time 10 https://indexer.ynxweb4.com/health | jq -e '.chainId==6423 and .ok==true' >/dev/null
curl -fsS --max-time 10 https://explorer.ynxweb4.com/health | jq -e '.network.chainId==6423 and .wallet.chainIdHex=="0x1917" and .ok==true' >/dev/null
curl -fsS --max-time 10 https://faucet.ynxweb4.com/health | jq -e '.chainId==6423 and .ok==true' >/dev/null
curl -fsS --max-time 10 https://ai.ynxweb4.com/health | jq -e '.chainId==6423 and .ok==true' >/dev/null
curl -fsS --max-time 10 https://rpc.ynxweb4.com/bridge/health | jq -e '.ok==true' >/dev/null
for url in https://grpc.ynxweb4.com/ https://evm-ws.ynxweb4.com/; do
  [[ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$url")" == 503 ]] || fail "FAIL_CLOSED_GATE_FAILED:$url"
done
[[ "$(curl -sS --max-time 10 --max-redirs 0 -o /dev/null -w '%{http_code}|%{redirect_url}' https://web4.ynxweb4.com/)" == "302|https://www.ynxweb4.com/" ]] || fail WEB4_SAFE_REDIRECT_FAILED
public_ok=true

while IFS=$'\t' read -r unit _pid unit_sha; do
  fragment="/etc/systemd/system/$unit"
  backup_unit="$recovery/primary-units/$unit"
  [[ -f "$fragment" && ! -L "$fragment" && "$(sha "$fragment")" == "$unit_sha" ]] || fail "LEGACY_UNIT_CHANGED_BEFORE_RETIRE:$unit"
  install -m 0600 -o root -g root "$fragment" "$backup_unit"
  systemctl disable --now "$unit"
  [[ "$(systemctl is-active "$unit" 2>/dev/null || true)" != active ]] || fail "LEGACY_STOP_FAILED:$unit"
  rm -f "$fragment"
  ln -s /dev/null "$fragment"
done < <(jq -r '.primary.legacyServices[]|[.unit,(.pid|tostring),.unitSha256]|@tsv' <<<"$signed_json")
systemctl daemon-reload
while IFS=$'\t' read -r unit _pid _sha; do
  [[ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" == masked ]] || fail "LEGACY_MASK_FAILED:$unit"
  [[ "$(systemctl is-active "$unit" 2>/dev/null || true)" != active ]] || fail "LEGACY_REACTIVATED:$unit"
done < <(jq -r '.primary.legacyServices[]|[.unit,(.pid|tostring),.unitSha256]|@tsv' <<<"$signed_json")
! ss -ltn | grep -Eq ':(36657|3854[56]|3808[0-9]|3809[01])([[:space:]]|$)' || fail LEGACY_PRIMARY_PORT_REMAINS

printf 'primaryCutover=6423\nprimaryLegacyServices=masked\ncaddySha256=%s\nrecoveryRoot=%s\n' "$(sha "$live")" "$recovery"
trap - EXIT
REMOTE
}

run_peer() {
  local role="$1" host="$2" user="$3" identity="$4"
  /usr/bin/ssh -i "$identity" "${ssh_common[@]}" "$user@$host" sudo -n /bin/bash -s -- "$signed_b64" "$role" <<'REMOTE'
set -Eeuo pipefail
signed_json="$(printf '%s' "$1" | base64 -d)"
role="$2"
peer="$(jq -c --arg role "$role" '.peers[]|select(.role==$role)' <<<"$signed_json")"
[[ -n "$peer" ]] || { echo PEER_ROLE_NOT_FOUND >&2; exit 65; }
recovery="/var/lib/ynx-chain/emergency-recovery/p0-326-chain-6423-$role"
unit="$(jq -r '.legacyUnit' <<<"$peer")"
expected_pid="$(jq -r '.pid' <<<"$peer")"
expected_tuple="$(jq -r '.unitTuple' <<<"$peer")"
expected_sha="$(jq -r '.unitSha256' <<<"$peer")"
fragment="/etc/systemd/system/$unit"
fail() { printf '%s\n' "$1" >&2; exit 65; }
tuple() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha() { sha256sum "$1" | awk '{print $1}'; }
[[ ! -e "$recovery" && ! -L "$recovery" ]] || fail RECOVERY_PATH_PREEXISTS
[[ -f "$fragment" && ! -L "$fragment" && "$(tuple "$fragment")" == "$expected_tuple" && "$(sha "$fragment")" == "$expected_sha" ]] || fail PEER_UNIT_DRIFT
[[ "$(systemctl is-active "$unit")" == active && "$(systemctl is-enabled "$unit")" == enabled ]] || fail PEER_STATE_DRIFT
[[ "$(systemctl show "$unit" -p MainPID --value)" == "$expected_pid" ]] || fail PEER_PID_DRIFT
install -d -m 0700 -o root -g root "$recovery"
install -m 0600 -o root -g root "$fragment" "$recovery/$unit"
systemctl disable --now "$unit"
rm -f "$fragment"
ln -s /dev/null "$fragment"

also="$(jq -r '.alsoMaskUnit // empty' <<<"$peer")"
if [[ -n "$also" ]]; then
  also_tuple="$(jq -r '.alsoMaskTuple' <<<"$peer")"
  also_sha="$(jq -r '.alsoMaskSha256' <<<"$peer")"
  also_fragment="/etc/systemd/system/$also"
  [[ -f "$also_fragment" && ! -L "$also_fragment" && "$(tuple "$also_fragment")" == "$also_tuple" && "$(sha "$also_fragment")" == "$also_sha" ]] || fail PEER_ALSO_UNIT_DRIFT
  [[ "$(systemctl is-active "$also" 2>/dev/null || true)" != active ]] || fail PEER_ALSO_UNIT_ACTIVE
  install -m 0600 -o root -g root "$also_fragment" "$recovery/$also"
  systemctl disable "$also" >/dev/null 2>&1 || true
  rm -f "$also_fragment"
  ln -s /dev/null "$also_fragment"
fi
systemctl daemon-reload
[[ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" == masked ]] || fail PEER_MASK_FAILED
[[ "$(systemctl is-active "$unit" 2>/dev/null || true)" != active ]] || fail PEER_STOP_FAILED
[[ -z "$also" || "$(systemctl is-enabled "$also" 2>/dev/null || true)" == masked ]] || fail PEER_ALSO_MASK_FAILED
! ss -ltn | grep -Eq ':(36657|38545)([[:space:]]|$)' || fail PEER_LEGACY_PORT_REMAINS
printf 'peerRole=%s\npeerLegacyServices=masked\npeerRecoveryRoot=%s\n' "$role" "$recovery"
REMOTE
}

main_impl() {
  printf 'phase=PRIMARY_6423_CUTOVER\n'
  run_primary
  printf 'terminal=CHAIN_6423_PUBLIC_RECOVERED_PRIMARY_9102_SERVICES_MASKED\n'
}

set +e
main_impl >"$stdout_path" 2>"$stderr_path"
status=$?
set -e
stdout_sha="$(sha256 "$stdout_path")"
stderr_sha="$(sha256 "$stderr_path")"
/usr/bin/jq -n \
  --arg taskId P0-326 \
  --arg operationId chain-6423-public-recovery-20260831T071700Z \
  --argjson exitStatus "$status" \
  --arg stdoutSha256 "$stdout_sha" \
  --arg stderrSha256 "$stderr_sha" \
  --arg terminal "$(if [[ $status -eq 0 ]]; then printf CHAIN_6423_PUBLIC_RECOVERED_PRIMARY_9102_SERVICES_MASKED; else printf EMERGENCY_BLOCKED_RETAIN_SAFE_6423_ROUTE_NO_9102_PUBLIC_ROLLBACK; fi)" \
  '{taskId:$taskId,operationId:$operationId,exitStatus:$exitStatus,stdoutSha256:$stdoutSha256,stderrSha256:$stderrSha256,terminal:$terminal,retryAllowed:false}' >"$receipt_path"
chmod 0600 "$stdout_path" "$stderr_path" "$receipt_path"
exit "$status"
