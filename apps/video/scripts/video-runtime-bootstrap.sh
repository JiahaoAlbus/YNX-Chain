#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
case "$action" in bootstrap|rollback-bootstrap) ;;
  *) echo "usage: video-runtime-bootstrap.sh bootstrap|rollback-bootstrap" >&2; exit 64 ;;
esac

mode=${YNX_VIDEO_EXECUTION_MODE:-}
root=${YNX_VIDEO_VIEWER_ROOT:-}
unit_name=${YNX_VIDEO_VIEWER_UNIT:-}
unit_path=${YNX_VIDEO_VIEWER_UNIT_PATH:-}
release_id=${YNX_VIDEO_PREDECESSOR_RELEASE_ID:-}
carrier=${YNX_VIDEO_PREDECESSOR_CARRIER:-}
expected_sha=${YNX_VIDEO_PREDECESSOR_CARRIER_SHA256:-}
predecessor_commit=${YNX_VIDEO_PREDECESSOR_SOURCE_COMMIT:-}
receipt=${YNX_VIDEO_BOOTSTRAP_RECEIPT:-}
unit_template=${YNX_VIDEO_UNIT_TEMPLATE:-}
unit_template_sha=${YNX_VIDEO_UNIT_TEMPLATE_SHA256:-}
control=${YNX_VIDEO_FIXTURE_CONTROL:-}

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ -n "$root" && -n "$unit_name" && -n "$unit_path" && -n "$release_id" && -n "$carrier" && -n "$expected_sha" && -n "$predecessor_commit" && -n "$receipt" && -n "$unit_template" && -n "$unit_template_sha" ]] || { echo "bootstrap binding missing" >&2; exit 65; }
[[ "$predecessor_commit" == "e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833" ]] || { echo "unexpected predecessor source" >&2; exit 65; }
[[ "$release_id" == "ynx-video-predecessor-$predecessor_commit" ]] || { echo "predecessor release mismatch" >&2; exit 65; }
[[ "$unit_name" == "ynx-video-viewer-wallet.service" ]] || { echo "unexpected dedicated unit" >&2; exit 66; }
[[ -f "$unit_template" && "$(shasum -a 256 "$unit_template" | awk '{print $1}')" == "$unit_template_sha" ]] || { echo "unit template SHA mismatch" >&2; exit 65; }
grep -Fxq 'User=ynx' "$unit_template" || { echo "unit user mismatch" >&2; exit 65; }
grep -Fxq 'Group=ynx' "$unit_template" || { echo "unit group mismatch" >&2; exit 65; }
grep -Fxq 'WorkingDirectory=/opt/ynx-video-viewer-wallet/current' "$unit_template" || { echo "unit working directory mismatch" >&2; exit 65; }
grep -Fxq 'ExecStart=/usr/bin/node /opt/ynx-video-viewer-wallet/current/server.mjs' "$unit_template" || { echo "unit entrypoint mismatch" >&2; exit 65; }
case "$root" in
  /opt/ynx-video|/opt/ynx-video/*) echo "shared Video runtime is forbidden" >&2; exit 66 ;;
esac

if [[ "$mode" == "production" ]]; then
  [[ "${YNX_VIDEO_LEASE_AUTHORIZED:-}" == "P0_VIDEO_BOOTSTRAP_SINGLE_USE" ]] || { echo "production bootstrap lease missing" >&2; exit 77; }
  [[ "$root" == "/opt/ynx-video-viewer-wallet" ]] || { echo "unexpected production root" >&2; exit 66; }
  [[ "$unit_path" == "/etc/systemd/system/ynx-video-viewer-wallet.service" ]] || { echo "unexpected production unit path" >&2; exit 66; }
else
  [[ -n "$control" && -x "$control/systemctl" ]] || { echo "fixture control missing" >&2; exit 65; }
fi

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
systemctl_exact() {
  if [[ "$mode" == "fixture" ]]; then "$control/systemctl" "$@"; else systemctl "$@"; fi
}
probe() {
  local role=$1
  if [[ "$mode" == "fixture" ]]; then "$control/probe-$role"; else
    case "$role" in
      api) curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6493/health ;;
      viewer) curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6494/ ;;
      creator) curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6495/ ;;
    esac
  fi
}
assert_root_shape() {
  [[ -d "$root/releases/$release_id" && -L "$root/current" ]] || return 1
  [[ "$(readlink "$root/current")" == "$root/releases/$release_id" ]] || return 1
  local top
  top=$(find "$root" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)
  [[ "$top" == "$root/current"$'\n'"$root/releases" ]] || return 1
  local releases_top
  releases_top=$(find "$root/releases" -mindepth 1 -maxdepth 1 -print)
  [[ "$releases_top" == "$root/releases/$release_id" ]]
}
assert_owned_partial_root() {
  [[ -d "$root" ]] || return 1
  local entry
  while IFS= read -r entry; do
    case "$entry" in "$root/current"|"$root/releases") ;; *) return 1 ;; esac
  done < <(find "$root" -mindepth 1 -maxdepth 1 -print)
  if [[ -L "$root/current" ]]; then
    [[ "$(readlink "$root/current")" == "$root/releases/$release_id" ]] || return 1
  elif [[ -e "$root/current" ]]; then
    return 1
  fi
  if [[ -d "$root/releases" ]]; then
    while IFS= read -r entry; do
      case "$entry" in "$root/releases/$release_id"|"$root/releases/.${release_id}.staging."*) ;; *) return 1 ;; esac
    done < <(find "$root/releases" -mindepth 1 -maxdepth 1 -print)
  fi
}
remove_exact_bootstrap() {
  local expected_unit_sha=$1
  systemctl_exact stop "$unit_name" || true
  systemctl_exact disable "$unit_name" || true
  if [[ -f "$unit_path" ]]; then
    [[ "$(sha256_file "$unit_path")" == "$expected_unit_sha" ]] || { echo "dedicated unit changed; refusing cleanup" >&2; return 76; }
    rm -f -- "$unit_path"
  fi
  systemctl_exact daemon-reload || true
  if [[ -e "$root" ]]; then
    assert_owned_partial_root || { echo "dedicated root shape changed; refusing cleanup" >&2; return 76; }
    rm -rf -- "$root"
  fi
}

if [[ "$action" == "rollback-bootstrap" ]]; then
  [[ -f "$receipt" ]] || { echo "bootstrap receipt missing" >&2; exit 66; }
  receipt_root=$(awk -F= '$1=="root"{print substr($0,index($0,"=")+1)}' "$receipt")
  receipt_unit=$(awk -F= '$1=="unit_path"{print substr($0,index($0,"=")+1)}' "$receipt")
  receipt_unit_sha=$(awk -F= '$1=="unit_sha256"{print $2}' "$receipt")
  receipt_release=$(awk -F= '$1=="release_id"{print $2}' "$receipt")
  [[ "$receipt_root" == "$root" && "$receipt_unit" == "$unit_path" && "$receipt_release" == "$release_id" ]] || { echo "bootstrap receipt mismatch" >&2; exit 65; }
  api_before=$(probe api | shasum -a 256 | awk '{print $1}')
  creator_before=$(probe creator | shasum -a 256 | awk '{print $1}')
  remove_exact_bootstrap "$receipt_unit_sha"
  api_after=$(probe api | shasum -a 256 | awk '{print $1}')
  creator_after=$(probe creator | shasum -a 256 | awk '{print $1}')
  [[ "$api_before" == "$api_after" && "$creator_before" == "$creator_after" ]] || { echo "API or Creator changed during bootstrap rollback" >&2; exit 74; }
  printf 'rolled_back_to_absent=true\napi_after_sha256=%s\ncreator_after_sha256=%s\n' "$api_after" "$creator_after" >> "$receipt"
  exit 0
fi

[[ ! -e "$root" && ! -L "$root" ]] || { echo "dedicated root must be absent" >&2; exit 73; }
[[ ! -e "$unit_path" && ! -L "$unit_path" ]] || { echo "dedicated unit must be absent" >&2; exit 73; }
[[ ! -e "$receipt" ]] || { echo "bootstrap receipt must be absent" >&2; exit 73; }
[[ "$(sha256_file "$carrier")" == "$expected_sha" ]] || { echo "predecessor carrier SHA mismatch" >&2; exit 65; }
api_before=$(probe api | shasum -a 256 | awk '{print $1}')
creator_before=$(probe creator | shasum -a 256 | awk '{print $1}')

created_root=false
installed_unit=false
unit_sha=""
fail_closed_bootstrap() {
  local code=$?
  trap - ERR
  if [[ "$created_root" == true || "$installed_unit" == true ]]; then remove_exact_bootstrap "$unit_sha" || true; fi
  exit "$code"
}
trap fail_closed_bootstrap ERR

mkdir -p "$root/releases"
created_root=true
stage="$root/releases/.${release_id}.staging.$$"
mkdir "$stage"
tar -xzf "$carrier" -C "$stage"
[[ -f "$stage/runtime/server.mjs" && -f "$stage/runtime/predecessor-manifest.json" ]] || { echo "predecessor runtime incomplete" >&2; exit 65; }
grep -Fq "\"sourceCommit\": \"$predecessor_commit\"" "$stage/runtime/predecessor-manifest.json" || { echo "predecessor manifest mismatch" >&2; exit 65; }
mv "$stage/runtime" "$root/releases/$release_id"
rmdir "$stage"
ln -s "$root/releases/$release_id" "$root/current"

unit_tmp="${unit_path}.next.$$"
cp "$unit_template" "$unit_tmp"
chmod 0644 "$unit_tmp"
unit_sha=$(sha256_file "$unit_tmp")
mv "$unit_tmp" "$unit_path"
installed_unit=true
systemctl_exact daemon-reload
systemctl_exact enable --now "$unit_name"
probe viewer >/dev/null
api_after=$(probe api | shasum -a 256 | awk '{print $1}')
creator_after=$(probe creator | shasum -a 256 | awk '{print $1}')
[[ "$api_before" == "$api_after" && "$creator_before" == "$creator_after" ]] || { echo "API or Creator changed during bootstrap" >&2; exit 74; }
assert_root_shape
printf 'root=%s\nunit_path=%s\nunit_name=%s\nunit_sha256=%s\nrelease_id=%s\npredecessor_commit=%s\ncarrier_sha256=%s\napi_sha256=%s\ncreator_sha256=%s\n' \
  "$root" "$unit_path" "$unit_name" "$unit_sha" "$release_id" "$predecessor_commit" "$expected_sha" "$api_after" "$creator_after" > "$receipt"
trap - ERR
