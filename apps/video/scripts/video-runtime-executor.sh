#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
case "$action" in deploy|rollback) ;;
  *) echo "usage: video-runtime-executor.sh deploy|rollback" >&2; exit 64 ;;
esac

mode=${YNX_VIDEO_EXECUTION_MODE:-}
root=${YNX_VIDEO_VIEWER_ROOT:-}
release_id=${YNX_VIDEO_RELEASE_ID:-}
carrier=${YNX_VIDEO_CARRIER:-}
expected_sha=${YNX_VIDEO_CARRIER_SHA256:-}
source_commit=${YNX_VIDEO_SOURCE_COMMIT:-}
receipt=${YNX_VIDEO_RECEIPT:-}
viewer_port=${YNX_VIDEO_VIEWER_PORT:-6494}
api_port=${YNX_VIDEO_API_PORT:-6493}
creator_port=${YNX_VIDEO_CREATOR_PORT:-6495}
fixture_control=${YNX_VIDEO_FIXTURE_CONTROL:-$root/fixture}

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ -n "$root" && -n "$release_id" && -n "$carrier" && -n "$expected_sha" && -n "$source_commit" && -n "$receipt" ]] || { echo "required runtime binding missing" >&2; exit 65; }
[[ "$release_id" =~ ^ynx-video-[0-9a-f]{40}$ ]] || { echo "release ID is not source-bound" >&2; exit 65; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ && "$release_id" == "ynx-video-$source_commit" ]] || { echo "source/release mismatch" >&2; exit 65; }
[[ "$viewer_port" == "6494" && "$api_port" == "6493" && "$creator_port" == "6495" ]] || { echo "production topology mismatch" >&2; exit 65; }

case "$root" in
  /opt/ynx-video/current|/opt/ynx-video/current/*|/opt/ynx-video) echo "shared Video runtime is forbidden" >&2; exit 66 ;;
esac
if [[ "$mode" == "production" ]]; then
  [[ "$root" == "/opt/ynx-video-viewer-wallet" ]] || { echo "unexpected production root" >&2; exit 66; }
  [[ "${YNX_VIDEO_LEASE_AUTHORIZED:-}" == "P0_VIDEO_SINGLE_USE" ]] || { echo "production lease authorization missing" >&2; exit 77; }
  [[ "${YNX_VIDEO_VIEWER_UNIT:-}" == "ynx-video-viewer-wallet.service" ]] || { echo "unexpected Viewer unit" >&2; exit 66; }
fi

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
probe() {
  local role=$1
  if [[ "$mode" == "fixture" ]]; then
    "$fixture_control/probe-$role"
  else
    case "$role" in
      api) curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:6493/health" ;;
      viewer) curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:6494/" ;;
      creator) curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:6495/" ;;
    esac
  fi
}
restart_viewer() {
  if [[ "$mode" == "fixture" ]]; then
    "$fixture_control/restart-viewer"
  else
    systemctl restart ynx-video-viewer-wallet.service
  fi
}
replace_link() {
  local target=$1
  local link=$2
  local next="${link}.next.$$"
  ln -s "$target" "$next"
  if mv --version >/dev/null 2>&1; then
    mv -Tf "$next" "$link"
  else
    mv -fh "$next" "$link"
  fi
}

releases="$root/releases"
current="$root/current"
candidate="$releases/$release_id"

if [[ "$action" == "deploy" ]]; then
  [[ ! -e "$candidate" ]] || { echo "candidate release already exists" >&2; exit 73; }
  [[ "$(sha256_file "$carrier")" == "$expected_sha" ]] || { echo "carrier SHA mismatch" >&2; exit 65; }

  api_before=$(probe api | shasum -a 256 | awk '{print $1}')
  creator_before=$(probe creator | shasum -a 256 | awk '{print $1}')
  previous=""
  if [[ -L "$current" ]]; then previous=$(readlink "$current"); fi
  [[ -n "$previous" ]] || { echo "frozen previous Viewer target required" >&2; exit 65; }

  mkdir -p "$releases"
  staging="$releases/.${release_id}.staging.$$"
  mkdir "$staging"
  trap 'rm -rf "$staging"' EXIT
  tar -xzf "$carrier" -C "$staging"
  [[ -f "$staging/runtime/server.mjs" && -f "$staging/runtime/runtime-manifest.json" ]] || { echo "runtime object incomplete" >&2; exit 65; }
  grep -Fq "\"sourceCommit\": \"$source_commit\"" "$staging/runtime/runtime-manifest.json" || { echo "runtime manifest source mismatch" >&2; exit 65; }
  mv "$staging/runtime" "$candidate"
  rmdir "$staging"
  trap - EXIT

  replace_link "$candidate" "$current"
  switched=true
  fail_closed_deploy() {
    local code=$?
    trap - ERR
    if [[ "${switched:-false}" == "true" && -n "$previous" ]]; then
      replace_link "$previous" "$current" || true
      restart_viewer || true
    fi
    exit "$code"
  }
  trap fail_closed_deploy ERR
  restart_viewer
  probe viewer >/dev/null
  api_after=$(probe api | shasum -a 256 | awk '{print $1}')
  creator_after=$(probe creator | shasum -a 256 | awk '{print $1}')
  [[ "$api_before" == "$api_after" && "$creator_before" == "$creator_after" ]] || { echo "API or Creator changed" >&2; exit 74; }

  printf 'source_commit=%s\nrelease_id=%s\ncandidate=%s\nprevious=%s\ncarrier_sha256=%s\napi_sha256=%s\ncreator_sha256=%s\n' \
    "$source_commit" "$release_id" "$candidate" "$previous" "$expected_sha" "$api_after" "$creator_after" > "$receipt"
  trap - ERR
  exit 0
fi

[[ -f "$receipt" ]] || { echo "deployment receipt missing" >&2; exit 66; }
receipt_candidate=$(awk -F= '$1=="candidate"{print substr($0,index($0,"=")+1)}' "$receipt")
receipt_previous=$(awk -F= '$1=="previous"{print substr($0,index($0,"=")+1)}' "$receipt")
receipt_source=$(awk -F= '$1=="source_commit"{print $2}' "$receipt")
[[ "$receipt_candidate" == "$candidate" && "$receipt_source" == "$source_commit" ]] || { echo "rollback receipt mismatch" >&2; exit 65; }
[[ -L "$current" && "$(readlink "$current")" == "$candidate" ]] || { echo "current Viewer is not the candidate" >&2; exit 65; }
[[ -n "$receipt_previous" ]] || { echo "no frozen previous Viewer target" >&2; exit 65; }

api_before=$(probe api | shasum -a 256 | awk '{print $1}')
creator_before=$(probe creator | shasum -a 256 | awk '{print $1}')
replace_link "$receipt_previous" "$current"
restart_viewer
probe viewer >/dev/null
api_after=$(probe api | shasum -a 256 | awk '{print $1}')
creator_after=$(probe creator | shasum -a 256 | awk '{print $1}')
[[ "$api_before" == "$api_after" && "$creator_before" == "$creator_after" ]] || { echo "API or Creator changed during rollback" >&2; exit 74; }
printf 'rolled_back_to=%s\napi_sha256=%s\ncreator_sha256=%s\n' "$receipt_previous" "$api_after" "$creator_after" >> "$receipt"
