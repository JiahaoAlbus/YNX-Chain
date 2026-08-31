#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${1:-}" == inspect ]] || { echo "usage: video-retained-takeover-preflight.sh inspect" >&2; exit 64; }
[[ "${YNX_VIDEO_EXECUTION_MODE:-}" == production ]] || { echo "production execution mode required" >&2; exit 65; }
[[ "${YNX_VIDEO_LEASE_AUTHORIZED:-}" == P0_VIDEO_RETAINED_TAKEOVER_PREFLIGHT_ZERO_WRITE ]] || { echo "zero-write preflight lease missing" >&2; exit 77; }

sha_file() { sha256sum "$1" | awk '{print $1}'; }
stat_full() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
emit_file() {
  local key=$1 path=$2
  if [[ -e "$path" || -L "$path" ]]; then
    printf '%s.path=%s\n' "$key" "$path"
    printf '%s.tuple=%s\n' "$key" "$(stat_full "$path")"
    if [[ -f "$path" && ! -L "$path" ]]; then printf '%s.sha256=%s\n' "$key" "$(sha_file "$path")"; fi
  else
    printf '%s.absent=true\n' "$key"
  fi
}
emit_unit() {
  local key=$1 unit=$2
  printf '%s.load=%s\n' "$key" "$(systemctl show "$unit" --property LoadState --value)"
  printf '%s.active=%s\n' "$key" "$(systemctl show "$unit" --property ActiveState --value)"
  printf '%s.sub=%s\n' "$key" "$(systemctl show "$unit" --property SubState --value)"
  printf '%s.pid=%s\n' "$key" "$(systemctl show "$unit" --property MainPID --value)"
  printf '%s.nrestarts=%s\n' "$key" "$(systemctl show "$unit" --property NRestarts --value)"
  printf '%s.fragment=%s\n' "$key" "$(systemctl show "$unit" --property FragmentPath --value)"
}
emit_listener() {
  local port=$1
  printf 'listener.%s=%s\n' "$port" "$(ss -H -ltnp "sport = :$port" | tr '\n' ';')"
}
emit_http() {
  local key=$1 url=$2 bytes digest
  bytes=$(curl --fail --silent --show-error --max-time 5 "$url" | wc -c | tr -d ' ')
  digest=$(curl --fail --silent --show-error --max-time 5 "$url" | sha256sum | awk '{print $1}')
  printf '%s.url=%s\n%s.bytes=%s\n%s.sha256=%s\n' "$key" "$url" "$key" "$bytes" "$key" "$digest"
}

printf 'schema=ynx-video-retained-takeover-preflight/1\n'
printf 'mutation_count=0\n'
emit_file legacy_unit_file /etc/systemd/system/ynx-video-viewer.service
emit_file dedicated_unit_file /etc/systemd/system/ynx-video-viewer-wallet.service
emit_file bootstrap /var/tmp/ynx-video-runtime-bootstrap-f1e8ed4c.sh
emit_file legacy_snapshot /var/tmp/video-legacy-viewer-controlled-takeover-baseline.txt
emit_file predecessor_carrier /var/tmp/ynx-video-predecessor-e5ce335-runtime.tar.gz
emit_file unit_template /var/tmp/ynx-video-viewer-wallet.service
emit_file caddy /etc/caddy/Caddyfile
emit_file retained_parent /var/lib/ynx-video-viewer-wallet-evidence
emit_file retained_identity /var/lib/ynx-video-viewer-wallet-evidence.identity
retained_names=(
  video-legacy-viewer-emergency-recovery.receipt
  video-viewer-wallet-controlled-takeover-3b1a062b.receipt
  video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor
  video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.expected
  video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.stable
)
mapfile -t retained_actual < <(find /var/lib/ynx-video-viewer-wallet-evidence -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
mapfile -t retained_expected < <(printf '%s\n' "${retained_names[@]}" | LC_ALL=C sort)
[[ "${retained_actual[*]}" == "${retained_expected[*]}" ]] || { echo "retained evidence direct-child inventory mismatch" >&2; exit 76; }
for retained_name in "${retained_names[@]}"; do
  retained_path="/var/lib/ynx-video-viewer-wallet-evidence/$retained_name"
  [[ -f "$retained_path" && ! -L "$retained_path" && "$(stat -c '%h' "$retained_path")" == 1 ]] || { echo "retained evidence entry type mismatch" >&2; exit 76; }
  printf 'retained_child.%s.tuple=%s\n' "$retained_name" "$(stat_full "$retained_path")"
  printf 'retained_child.%s.sha256=%s\n' "$retained_name" "$(sha_file "$retained_path")"
done
emit_file new_receipt_parent /var/lib/ynx-video-viewer-wallet-evidence-560c467d
emit_file new_receipt_identity /var/lib/ynx-video-viewer-wallet-evidence-560c467d.identity
emit_file dedicated_root /opt/ynx-video-viewer-wallet
emit_file control_root /opt/ynx-release-control-plane/video-viewer-wallet-560c467d
printf 'shared_current.path=/opt/ynx-video/current\n'
printf 'shared_current.tuple=%s\n' "$(stat_full /opt/ynx-video/current)"
printf 'shared_current.target=%s\n' "$(readlink /opt/ynx-video/current)"
emit_unit legacy_unit ynx-video-viewer.service
emit_unit dedicated_unit ynx-video-viewer-wallet.service
emit_unit api_unit ynx-video-api.service
emit_unit creator_unit ynx-creator-studio.service
emit_unit caddy_unit caddy.service
emit_listener 6493
emit_listener 6494
emit_listener 6495
emit_http viewer http://127.0.0.1:6494/
emit_http api_root http://127.0.0.1:6493/
emit_http api_health http://127.0.0.1:6493/health
emit_http api_version http://127.0.0.1:6493/version
emit_http creator_root http://127.0.0.1:6495/
emit_http creator_manifest http://127.0.0.1:6495/creator-studio.manifest.json
emit_http creator_catalog http://127.0.0.1:6495/i18n/catalog.json
printf 'terminal=VIDEO_RETAINED_TAKEOVER_PREFLIGHT_ZERO_WRITE_COMPLETE\n'
