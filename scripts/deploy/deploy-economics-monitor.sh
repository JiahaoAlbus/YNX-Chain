#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh
ynx_load_env

dry_run="${DEPLOY_DRY_RUN:-0}"
PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-43.153.202.237}}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-ubuntu}}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-/dev/null}}"

ynx_require_env EXPLORER_DOMAIN
ynx_reject_unsafe_env_values EXPLORER_DOMAIN
if [[ "$dry_run" != "1" ]]; then
  ynx_require_env PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY
  [[ -r "$PRIMARY_NODE_SSH_KEY" ]] || { echo "primary SSH key is not readable"; exit 1; }
  ynx_require_clean_worktree
fi

source_commit="$(git rev-parse HEAD)"
short_commit="${source_commit:0:12}"
release="ynx-economics-monitor-$short_commit"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/package/bin" "$work/package/config" "$work/package/systemd"

ldflags="-s -w -X main.buildCommit=${source_commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$ldflags" \
  -o "$work/package/bin/ynx-economics-monitord" ./cmd/ynx-economics-monitord

cat >"$work/package/config/ynx-economics-monitord.env" <<EOF
YNX_ECONOMICS_MONITOR_HTTP_ADDR=127.0.0.1:6438
YNX_PUBLIC_STABLE_RESERVE_URL=https://${EXPLORER_DOMAIN}/api/stable/reserve
YNX_PUBLIC_YUSD_SANDBOX_URL=https://${EXPLORER_DOMAIN}/api/stable/yusd-sandbox
YNX_ECONOMICS_MONITOR_INTERVAL=15s
YNX_ECONOMICS_MONITOR_TIMEOUT=10s
EOF
chmod 0600 "$work/package/config/ynx-economics-monitord.env"
cp infra/monitoring/systemd/ynx-economics-monitord.service "$work/package/systemd/"
cp scripts/deploy/remote/install-economics-monitor.sh "$work/package/install.sh"
chmod 0755 "$work/package/install.sh"
(
  cd "$work/package"
  find bin config systemd -type f -print0 | sort -z | xargs -0 shasum -a 256 >SHA256SUMS
)
archive="$work/$release.tar.gz"
tar -czf "$archive" -C "$work/package" .
chmod 0600 "$archive"
archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"

if [[ "$dry_run" == "1" ]]; then
  bash -n scripts/deploy/remote/install-economics-monitor.sh
  test -x "$work/package/bin/ynx-economics-monitord"
  grep -Fq 'EnvironmentFile=/etc/ynx/ynx-economics-monitord.env' "$work/package/systemd/ynx-economics-monitord.service"
  grep -Fq "YNX_PUBLIC_STABLE_RESERVE_URL=https://${EXPLORER_DOMAIN}/api/stable/reserve" "$work/package/config/ynx-economics-monitord.env"
  grep -Fq "YNX_PUBLIC_YUSD_SANDBOX_URL=https://${EXPLORER_DOMAIN}/api/stable/yusd-sandbox" "$work/package/config/ynx-economics-monitord.env"
  echo "scoped Economics Monitor deployment dry-run passed: release=$release archiveSHA256=$archive_hash"
  exit 0
fi

remote="${PRIMARY_NODE_USER}@${PRIMARY_NODE_HOST}"
remote_archive="/tmp/$release.tar.gz"
remote_dir="/tmp/$release"
ynx_transport_scp economics-monitor-upload "$PRIMARY_NODE_SSH_KEY" "$archive" "$remote" "$remote_archive"
ynx_transport_ssh economics-monitor-stage "$PRIMARY_NODE_SSH_KEY" "$remote" \
  "set -euo pipefail; test \"\$(stat -c %a '$remote_archive')\" = 600; printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -; rm -rf '$remote_dir'; install -d -m 0700 '$remote_dir'; tar -xzf '$remote_archive' -C '$remote_dir'; rm -f '$remote_archive'"
ynx_transport_ssh economics-monitor-install "$PRIMARY_NODE_SSH_KEY" "$remote" \
  "bash '$remote_dir/install.sh' '$remote_dir' '$release' '$source_commit'"
ynx_transport_ssh economics-monitor-cleanup "$PRIMARY_NODE_SSH_KEY" "$remote" "rm -rf '$remote_dir'"

echo "scoped Economics Monitor Testnet deployment completed: release=$release sourceCommit=$source_commit"
