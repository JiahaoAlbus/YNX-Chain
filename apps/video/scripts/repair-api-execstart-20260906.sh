#!/usr/bin/env bash
# Coordinator-authorized, same-binary restart repair. Never reads secret values.
set -Eeuo pipefail
unit=ynx-videod.service
binary=/opt/ynx-video/releases/1883d406f77f94cb81171b79fe9518882ede0b16/ynx-videod
binary_sha=6fb91e9030a00a7b0ea88a11629f1442a6f6e4d8dea8720f64fd997e98b7831d
dropin=/etc/systemd/system/ynx-videod.service.d/20260906-executable.conf
[[ $EUID == 0 && ! -e $dropin ]]
[[ -z $(systemctl show "$unit" --property=DropInPaths --value) ]]
[[ $(sha256sum /etc/systemd/system/ynx-videod.service | cut -d' ' -f1) == d86450cae478510c94b0b7af9d78fb4241ebd691a41e3864ca296eefe16a2e4f ]]
[[ $(sha256sum "$binary" | cut -d' ' -f1) == "$binary_sha" ]]
sudo -u ynx test -x "$binary"
[[ -r /etc/ynx/ynx-videod.env ]]
[[ $(systemctl show "$unit" --property=EnvironmentFiles --value) == '/etc/ynx/ynx-videod.env (ignore_errors=no)' ]]
old_pid=$(systemctl show "$unit" --property=MainPID --value)
[[ $old_pid =~ ^[1-9][0-9]*$ && $(readlink -f "/proc/$old_pid/exe") == "$binary" ]]
[[ $(sha256sum "/proc/$old_pid/exe" | cut -d' ' -f1) == "$binary_sha" ]]

neighbors() {
  systemctl show ynx-video-viewer.service ynx-creator-studio-wallet.service --property=Id,MainPID,ActiveState,ExecMainStartTimestampMonotonic --no-pager
  sha256sum /etc/systemd/system/ynx-video-viewer.service /etc/systemd/system/ynx-video-viewer.service.d/20260906-audit.conf /etc/systemd/system/ynx-creator-studio-wallet.service /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy
  readlink -f /opt/ynx-video/current
  curl -fsS --max-time 10 http://127.0.0.1:6494/app.js | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6495/ | sha256sum
}
api_state() {
  curl -fsS --max-time 10 http://127.0.0.1:6493/health | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6493/version | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6493/v1/videos | sha256sum
}
before_neighbors=$(neighbors)
before_api=$(api_state)
printf 'OLD_PID=%s\nBINARY_SHA256=%s\nNEIGHBORS_BEFORE\n%s\nAPI_BEFORE\n%s\n' "$old_pid" "$binary_sha" "$before_neighbors" "$before_api"
installed=0
restarted=0
on_failure() {
  local code=$?
  trap - ERR
  if [[ $installed == 1 && $restarted == 0 ]]; then
    rm -- "$dropin"
    systemctl daemon-reload
    printf 'CONFIGURATION_RESTORED_WITHOUT_RESTART=true\n'
  elif [[ $restarted == 1 ]]; then
    printf 'RECOVERY_TARGET_RETAINED=%s\nDANGLING_OLD_EXECSTART_NOT_RESTORED=true\n' "$binary"
  fi
  printf 'FAILED_EXIT=%s\n' "$code"
  exit "$code"
}
trap on_failure ERR
install -d -m 755 "$(dirname "$dropin")"
cat > "$dropin" <<EOF
[Service]
ExecStart=
ExecStart=$binary
EOF
chmod 644 "$dropin"
installed=1
systemctl daemon-reload
systemd-analyze verify "$unit"
[[ $(systemctl show "$unit" --property=ExecStart --value) == *"path=$binary ;"* ]]
[[ $(systemctl show "$unit" --property=EnvironmentFiles --value) == '/etc/ynx/ynx-videod.env (ignore_errors=no)' ]]
[[ $(systemctl show "$unit" --property=MainPID --value) == "$old_pid" ]]
[[ $(neighbors) == "$before_neighbors" ]]
restarted=1
systemctl restart "$unit"
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:6493/health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
new_pid=$(systemctl show "$unit" --property=MainPID --value)
[[ $new_pid =~ ^[1-9][0-9]*$ && $new_pid != "$old_pid" && $(readlink -f "/proc/$new_pid/exe") == "$binary" ]]
[[ $(sha256sum "/proc/$new_pid/exe" | cut -d' ' -f1) == "$binary_sha" ]]
[[ $(api_state) == "$before_api" ]]
[[ $(neighbors) == "$before_neighbors" ]]
printf 'NEW_PID=%s\nNEIGHBORS_AFTER\n%s\nAPI_AFTER\n%s\n' "$new_pid" "$(neighbors)" "$(api_state)"
systemctl show "$unit" --property=ExecStart,EnvironmentFiles,MainPID,ActiveState,NRestarts,DropInPaths --no-pager
sha256sum "$dropin"
printf 'SAME_BINARY_RESTART_VERIFIED=true\nVIEWER_CREATOR_CADDY_SHARED_UNCHANGED=true\n'
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
