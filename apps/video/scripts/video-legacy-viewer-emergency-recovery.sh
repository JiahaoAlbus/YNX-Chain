#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
[[ "$action" == recover ]] || { echo "usage: video-legacy-viewer-emergency-recovery.sh recover" >&2; exit 64; }

mode=${YNX_VIDEO_EXECUTION_MODE:-}
link=${YNX_VIDEO_SHARED_CURRENT:-}
target=${YNX_VIDEO_SHARED_TARGET:-}
link_tuple=${YNX_VIDEO_SHARED_LINK_TUPLE:-}
target_tuple=${YNX_VIDEO_SHARED_TARGET_TUPLE:-}
apps_tuple=${YNX_VIDEO_SHARED_APPS_TUPLE:-}
carrier=${YNX_VIDEO_PREDECESSOR_CARRIER:-}
carrier_sha=${YNX_VIDEO_PREDECESSOR_CARRIER_SHA256:-}
unit=${YNX_VIDEO_LEGACY_UNIT:-}
unit_path=${YNX_VIDEO_LEGACY_UNIT_PATH:-}
unit_sha=${YNX_VIDEO_LEGACY_UNIT_SHA256:-}
caddy=${YNX_VIDEO_CADDY_PATH:-}
caddy_sha=${YNX_VIDEO_CADDY_SHA256:-}
receipt=${YNX_VIDEO_RECOVERY_RECEIPT:-}
control=${YNX_VIDEO_FIXTURE_CONTROL:-}

[[ "$mode" == fixture || "$mode" == production ]] || exit 65
[[ -n "$link" && -n "$target" && -n "$link_tuple" && -n "$target_tuple" && -n "$apps_tuple" && -n "$carrier" && -n "$carrier_sha" && -n "$unit" && -n "$unit_path" && -n "$unit_sha" && -n "$caddy" && -n "$caddy_sha" && -n "$receipt" ]] || exit 65
if [[ "$mode" == production ]]; then
  [[ "${YNX_VIDEO_LEASE_AUTHORIZED:-}" == P0_VIDEO_LEGACY_SUBTREE_RECOVERY_SINGLE_USE ]] || exit 77
  [[ "$link" == /opt/ynx-video/current && "$target" == /opt/ynx-video/releases/p0205-creator-studio-0e1a53c5 ]] || exit 66
  [[ "$unit" == ynx-video-viewer.service && "$unit_path" == /etc/systemd/system/ynx-video-viewer.service && "$caddy" == /etc/caddy/Caddyfile ]] || exit 66
else
  [[ -n "$control" && -x "$control/stat-tuple" && -x "$control/systemctl" && -x "$control/probe" ]] || exit 65
fi

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
tuple() { if [[ "$mode" == fixture ]]; then "$control/stat-tuple" "$1"; else stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; fi; }
systemctl_exact() { if [[ "$mode" == fixture ]]; then "$control/systemctl" "$@"; else systemctl "$@"; fi; }
probe() { if [[ "$mode" == fixture ]]; then "$control/probe" "$1"; else curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$2$3"; fi; }

expected_files='app.js
i18n.js
index.html
predecessor-manifest.json
responsive.css
server.mjs
styles.css
wallet-connection.js
ynx-dapp-connect-sdk/constants.js
ynx-dapp-connect-sdk/discovery.js
ynx-dapp-connect-sdk/errors.js
ynx-dapp-connect-sdk/manifest.json
ynx-dapp-connect-sdk/provider.js'
expected_hashes='ff7d300d2c84b0580b53e05524524385914f0547f7c869cee34d7ec0b93f26c4  app.js
b43f600316d2dd5d33c92205e5e1490a093cdc55005072943ad68a6e3311aae4  i18n.js
5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a  index.html
30df70e652d519e32dcd7648493b8c17e03425a67ec332efcc826bc50ca366da  predecessor-manifest.json
28078b12ed41f6aacf08e6b0177d8f1dd426755aa638d9b1cf56ab8bdd4502de  responsive.css
59ef5e250a2236dd498ccbbdf5ed46a385ed77c49b81c4fc9724949c48de28e7  server.mjs
9f0b031c26f2f4f4ffc1fdb1209f85250080fd5c0e76ecb2e5bf2dbca5f15c43  styles.css
33f5449c96f7b58286b0cc7afa070b0a115210a3c49459e0c4516cfcd72adf9e  wallet-connection.js
c07741eab50a665810dd000dd533f51dfd3078d2c829138cba2eb9d3bb91908c  ynx-dapp-connect-sdk/constants.js
7e8fed32b7ba6528054743c3cd8fafa95370d1ece0c8541d154ae37f05d75f13  ynx-dapp-connect-sdk/discovery.js
e766988819ed54eb7eeb3bf79c7943de30daa7cbaf682d92ec74c68b63f1ed4c  ynx-dapp-connect-sdk/errors.js
bea2c2facae245c6480f3d2f436fbd4157003cbeae73d968bb1808decc027407  ynx-dapp-connect-sdk/manifest.json
67d48625c5c97df7e327f37ae96d4563dee9467078725d65100a2fe752912335  ynx-dapp-connect-sdk/provider.js'

assert_runtime() {
  local root=$1 actual hashes
  actual=$(cd "$root" && find . -type f -print | sed 's#^./##' | LC_ALL=C sort)
  [[ "$actual" == "$expected_files" ]] || return 1
  hashes=$(cd "$root" && while IFS= read -r f; do printf '%s  %s\n' "$(sha "$f")" "$f"; done <<< "$expected_files")
  [[ "$hashes" == "$expected_hashes" ]] || return 1
  if [[ "$mode" == fixture ]]; then
    [[ "$(stat -f '%Lp' "$root/server.mjs")" == 755 ]] || return 1
  else
    [[ "$(stat -c '%a' "$root/server.mjs")" == 755 ]] || return 1
  fi
}
assert_production_identity() {
  [[ "$mode" != production ]] && return 0
  [[ -z "$(find "$1" \( ! -user ynx -o ! -group ynx \) -print -quit)" ]] || return 1
  [[ -z "$(find "$1" -type d ! -perm 0755 -print -quit)" ]] || return 1
  [[ -z "$(find "$1" -type f ! -name server.mjs ! -perm 0644 -print -quit)" ]] || return 1
  [[ "$(stat -c '%a' "$1/server.mjs")" == 755 ]] || return 1
}
assert_bindings() {
  [[ -L "$link" && "$(readlink "$link")" == "$target" && "$(tuple "$link")" == "$link_tuple" ]] || return 1
  [[ "$(tuple "$target")" == "$target_tuple" && "$(tuple "$target/apps")" == "$apps_tuple" ]] || return 1
  [[ "$(sha "$carrier")" == "$carrier_sha" && "$(sha "$unit_path")" == "$unit_sha" && "$(sha "$caddy")" == "$caddy_sha" ]] || return 1
}

assert_bindings
[[ ! -e "$target/apps/video" && ! -L "$target/apps/video" && ! -e "$receipt" ]] || exit 73
api_before=$(probe api 6493 /health | shasum -a 256 | awk '{print $1}')
creator_before=$(probe creator 6495 / | shasum -a 256 | awk '{print $1}')
stage="$target/apps/.video-recovery.$$"
mkdir "$stage"
created=false
created_tuple=""
cleanup() {
  local code=$?
  trap - ERR INT TERM
  systemctl_exact stop "$unit" >/dev/null 2>&1 || true
  if [[ "$created" == true && -d "$target/apps/video" ]]; then
    if [[ "$(tuple "$target/apps/video")" == "$created_tuple" ]] && assert_runtime "$target/apps/video" && assert_production_identity "$target/apps/video"; then
      find "$target/apps/video" -depth -delete
    else
      echo "new Viewer subtree identity changed; refusing cleanup" >&2
    fi
  elif [[ -d "$stage" ]]; then
    find "$stage" -depth -delete
  fi
  exit "$code"
}
trap cleanup ERR INT TERM
tar -xzf "$carrier" -C "$stage"
[[ -d "$stage/runtime" ]] || exit 65
assert_runtime "$stage/runtime"
if [[ "$mode" == production ]]; then chown -R 995:986 "$stage/runtime"; fi
mv "$stage/runtime" "$target/apps/video"
rmdir "$stage"
created=true
created_tuple=$(tuple "$target/apps/video")
assert_runtime "$target/apps/video"
assert_production_identity "$target/apps/video"
systemctl_exact reset-failed "$unit"
systemctl_exact start "$unit"
attempts=${YNX_VIDEO_RECOVERY_PROBE_ATTEMPTS:-25}
delay=${YNX_VIDEO_RECOVERY_PROBE_DELAY_SECONDS:-0.2}
[[ "$attempts" =~ ^[1-9][0-9]*$ && "$attempts" -le 60 && "$delay" =~ ^(0|[0-9]+([.][0-9]+)?)$ ]] || exit 65
ready=false
for _ in $(seq 1 "$attempts"); do
  if viewer_sha=$(probe viewer 6494 / 2>/dev/null | shasum -a 256 | awk '{print $1}') && [[ "$viewer_sha" == 5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a ]]; then ready=true; break; fi
  sleep "$delay"
done
[[ "$ready" == true ]] || exit 74
api_after=$(probe api 6493 /health | shasum -a 256 | awk '{print $1}')
creator_after=$(probe creator 6495 / | shasum -a 256 | awk '{print $1}')
[[ "$api_after" == "$api_before" && "$creator_after" == "$creator_before" ]] || exit 74
[[ "$(sha "$caddy")" == "$caddy_sha" && "$(readlink "$link")" == "$target" ]] || exit 74
pid=$(systemctl_exact show "$unit" --property MainPID --value)
restarts=$(systemctl_exact show "$unit" --property NRestarts --value)
[[ "$pid" =~ ^[1-9][0-9]*$ && "$restarts" == 0 ]] || exit 74
printf 'recovered=true\nsubtree=%s\nsubtree_tuple=%s\ncarrier_sha256=%s\nviewer_sha256=%s\napi_sha256=%s\ncreator_sha256=%s\npid=%s\nnrestarts=%s\n' \
  "$target/apps/video" "$created_tuple" "$carrier_sha" 5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a "$api_after" "$creator_after" "$pid" "$restarts" > "$receipt"
trap - ERR INT TERM
