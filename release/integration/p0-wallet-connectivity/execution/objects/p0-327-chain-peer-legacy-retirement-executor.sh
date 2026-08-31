#!/usr/bin/env bash
set -Eeuo pipefail

signed_input="${1:?signed input path required}"
signed_sha="${2:?signed input SHA-256 required}"
stdout_path="${3:?stdout path required}"
stderr_path="${4:?stderr path required}"
receipt_path="${5:?receipt path required}"
ack="${6:?execution acknowledgement required}"

fail() { printf '%s\n' "$1" >&2; exit 65; }
sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }

[[ "$ack" == "P0-327:EXECUTE_CHAIN_PEER_LEGACY_RETIREMENT_ONCE" ]] || fail ACK_MISMATCH
[[ -f "$signed_input" && ! -L "$signed_input" ]] || fail SIGNED_INPUT_INVALID
[[ "$(sha256 "$signed_input")" == "$signed_sha" ]] || fail SIGNED_INPUT_SHA_MISMATCH
[[ "$(/usr/bin/jq -r '.ack' "$signed_input")" == "$ack" ]] || fail SIGNED_ACK_MISMATCH
[[ "$(/usr/bin/jq -r '.predecessor.terminal' "$signed_input")" == "CHAIN_6423_PUBLIC_RECOVERED_PRIMARY_9102_SERVICES_MASKED" ]] || fail PREDECESSOR_TERMINAL_MISMATCH
[[ "$(/usr/bin/jq -r '.peers|length' "$signed_input")" == 3 ]] || fail PEER_CARDINALITY_MISMATCH
for output in "$stdout_path" "$stderr_path" "$receipt_path"; do
  [[ ! -e "$output" && ! -L "$output" ]] || fail "LOCAL_OUTPUT_PREEXISTS:$output"
done
for name in YNX_CHAIN_SG_SSH_IDENTITY YNX_CHAIN_SV_SSH_IDENTITY YNX_CHAIN_SEOUL_SSH_IDENTITY; do
  value="${!name:-}"
  [[ -n "$value" && -f "$value" && ! -L "$value" && -r "$value" ]] || fail "PROTECTED_IDENTITY_UNAVAILABLE:$name"
done

signed_b64="$(/usr/bin/base64 < "$signed_input" | /usr/bin/tr -d '\n')"
known_hosts="/Users/huangjiahao/.ssh/known_hosts"
ssh_common=(-o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" -o ConnectTimeout=10 -o ConnectionAttempts=1)

run_peer() {
  local role="$1" host user identity identity_ref remote_bash
  host="$(/usr/bin/jq -r --arg role "$role" '.peers[]|select(.role==$role)|.host' "$signed_input")"
  user="$(/usr/bin/jq -r --arg role "$role" '.peers[]|select(.role==$role)|.user' "$signed_input")"
  identity_ref="$(/usr/bin/jq -r --arg role "$role" '.peers[]|select(.role==$role)|.identityReference' "$signed_input")"
  identity="${!identity_ref:-}"
  [[ -n "$host" && "$host" != null && -n "$user" && "$user" != null && -n "$identity" ]] || fail "PEER_LOCAL_BINDING_MISSING:$role"
  if [[ "$user" == root ]]; then
    remote_bash=(/bin/bash -s -- "$signed_b64" "$role")
  else
    remote_bash=(sudo -n /bin/bash -s -- "$signed_b64" "$role")
  fi
  /usr/bin/ssh -i "$identity" "${ssh_common[@]}" "$user@$host" "${remote_bash[@]}" <<'REMOTE'
set -Eeuo pipefail
signed_json="$(printf '%s' "$1" | base64 -d)"
role="$2"
peer="$(jq -c --arg role "$role" '.peers[]|select(.role==$role)' <<<"$signed_json")"
[[ -n "$peer" ]] || { printf 'PEER_ROLE_NOT_FOUND\n' >&2; exit 65; }
fail() { printf '%s\n' "$1" >&2; exit 65; }
tuple() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha() { sha256sum "$1" | awk '{print $1}'; }
unit="$(jq -r '.legacyUnit' <<<"$peer")"
expected_pid="$(jq -r '.pid' <<<"$peer")"
expected_tuple="$(jq -r '.unitTuple' <<<"$peer")"
expected_sha="$(jq -r '.unitSha256' <<<"$peer")"
fragment="/etc/systemd/system/$unit"
recovery="/var/lib/ynx-chain/emergency-recovery/p0-327-peer-legacy-retirement-$role"
[[ ! -e "$recovery" && ! -L "$recovery" ]] || fail RECOVERY_PATH_PREEXISTS
[[ -f "$fragment" && ! -L "$fragment" && "$(tuple "$fragment")" == "$expected_tuple" && "$(sha "$fragment")" == "$expected_sha" ]] || fail PEER_UNIT_DRIFT
[[ "$(systemctl is-active "$unit")" == active && "$(systemctl is-enabled "$unit")" == enabled ]] || fail PEER_STATE_DRIFT
[[ "$(systemctl show "$unit" -p MainPID --value)" == "$expected_pid" ]] || fail PEER_PID_DRIFT
install -d -m 0700 -o root -g root "$recovery"
[[ -d "$recovery" && ! -L "$recovery" ]] || fail RECOVERY_ROOT_SUBSTITUTION
install -m 0600 -o root -g root "$fragment" "$recovery/$unit"
[[ "$(sha "$recovery/$unit")" == "$expected_sha" ]] || fail PEER_BACKUP_SHA_MISMATCH
systemctl disable --now "$unit"
[[ "$(systemctl is-active "$unit" 2>/dev/null || true)" != active ]] || fail PEER_STOP_FAILED
[[ -f "$fragment" && ! -L "$fragment" && "$(tuple "$fragment")" == "$expected_tuple" && "$(sha "$fragment")" == "$expected_sha" ]] || fail PEER_UNIT_CHANGED_BEFORE_MASK
rm "$fragment"
ln -s /dev/null "$fragment"

also="$(jq -r '.alsoMaskUnit // empty' <<<"$peer")"
if [[ -n "$also" ]]; then
  also_fragment="/etc/systemd/system/$also"
  also_tuple="$(jq -r '.alsoMaskTuple' <<<"$peer")"
  also_sha="$(jq -r '.alsoMaskSha256' <<<"$peer")"
  [[ "$(systemctl is-active "$also" 2>/dev/null || true):$(systemctl show "$also" -p SubState --value 2>/dev/null || true):$(systemctl is-enabled "$also" 2>/dev/null || true)" == "inactive:dead:disabled" ]] || fail PEER_COMPANION_STATE_DRIFT
  [[ -f "$also_fragment" && ! -L "$also_fragment" && "$(tuple "$also_fragment")" == "$also_tuple" && "$(sha "$also_fragment")" == "$also_sha" ]] || fail PEER_COMPANION_UNIT_DRIFT
  install -m 0600 -o root -g root "$also_fragment" "$recovery/$also"
  [[ "$(sha "$recovery/$also")" == "$also_sha" ]] || fail PEER_COMPANION_BACKUP_SHA_MISMATCH
  systemctl disable "$also"
  [[ -f "$also_fragment" && ! -L "$also_fragment" && "$(tuple "$also_fragment")" == "$also_tuple" && "$(sha "$also_fragment")" == "$also_sha" ]] || fail PEER_COMPANION_CHANGED_BEFORE_MASK
  rm "$also_fragment"
  ln -s /dev/null "$also_fragment"
fi
systemctl daemon-reload
[[ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" == masked ]] || fail PEER_MASK_FAILED
[[ "$(systemctl is-active "$unit" 2>/dev/null || true)" != active ]] || fail PEER_REACTIVATED
[[ -z "$also" || "$(systemctl is-enabled "$also" 2>/dev/null || true)" == masked ]] || fail PEER_COMPANION_MASK_FAILED
! ss -ltn | grep -Eq ':(36657|38545)([[:space:]]|$)' || fail PEER_LEGACY_PORT_REMAINS
printf 'peerRole=%s\npeerLegacyServices=masked\npeerRecoveryRoot=%s\n' "$role" "$recovery"
REMOTE
}

main_impl() {
  printf 'phase=PEER_LEGACY_RETIREMENT\n'
  run_peer singapore
  run_peer silicon-valley
  run_peer seoul
  printf 'terminal=CHAIN_6423_PUBLIC_RECOVERED_PEER_LEGACY_SERVICES_MASKED\n'
}

set +e
( set -Eeuo pipefail; main_impl ) >"$stdout_path" 2>"$stderr_path"
status=$?
set -e
stdout_sha="$(sha256 "$stdout_path")"
stderr_sha="$(sha256 "$stderr_path")"
/usr/bin/jq -n \
  --arg taskId P0-327 \
  --arg operationId chain-peer-legacy-retirement-20260831T074300Z \
  --argjson exitStatus "$status" \
  --arg stdoutSha256 "$stdout_sha" \
  --arg stderrSha256 "$stderr_sha" \
  --arg terminal "$(if [[ $status -eq 0 ]]; then printf CHAIN_6423_PUBLIC_RECOVERED_PEER_LEGACY_SERVICES_MASKED; else printf EMERGENCY_BLOCKED_RETAIN_SAFE_6423_PUBLIC_ROUTE_AND_PEER_STATE; fi)" \
  '{taskId:$taskId,operationId:$operationId,exitStatus:$exitStatus,stdoutSha256:$stdoutSha256,stderrSha256:$stderrSha256,terminal:$terminal,retryAllowed:false}' >"$receipt_path"
chmod 0600 "$stdout_path" "$stderr_path" "$receipt_path"
exit "$status"
