#!/usr/bin/env bash
# Deploy only the source-bound ynx-chaind binary needed for the bounded
# replication repair. It deliberately never calls the full-stack deployment.
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh

mode="${1:---deploy}"
[[ "$mode" == "--deploy" || "$mode" == "--preflight" ]] || {
  echo "usage: $0 [--preflight|--deploy]" >&2
  exit 64
}

fail() { echo "bounded replication recovery: $*" >&2; exit 1; }

candidate_commit="$(git rev-parse HEAD)"
release_dir="${YNX_BOUNDED_REPLICATION_RELEASE_DIR:-}"
if [[ -z "$release_dir" ]]; then
  release_dirs=()
  for candidate in tmp/deploy/ynx-chain-*; do
    [[ -d "$candidate" ]] && release_dirs+=("$candidate")
  done
  [[ "${#release_dirs[@]}" == "1" ]] || fail "set YNX_BOUNDED_REPLICATION_RELEASE_DIR to one exact prepared release directory"
  release_dir="${release_dirs[0]}"
fi
[[ -d "$release_dir" ]] || fail "prepared release directory not found: $release_dir"
release="$(basename "$release_dir")"
[[ "$release" =~ ^ynx-chain-[0-9a-f]{12}$ ]] || fail "prepared release directory name is invalid: $release"
release_short="${release#ynx-chain-}"
release_commit="$(node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1])); process.stdout.write(x.commit)' "$release_dir/config/release-manifest.json")"
[[ "$release_commit" =~ ^[0-9a-f]{12}$ && "$release_commit" == "$release_short" ]] || fail "prepared release manifest commit does not match its release directory"
bundle="${YNX_BOUNDED_REPLICATION_BUNDLE:-tmp/deploy/${release}.tar.gz}"
expected_bundle_sha="${YNX_BOUNDED_REPLICATION_BUNDLE_SHA256:-}"
dry_run="${DEPLOY_DRY_RUN:-0}"
attempt_id="${YNX_BOUNDED_REPLICATION_ATTEMPT_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$attempt_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "YNX_BOUNDED_REPLICATION_ATTEMPT_ID must be UTC timestamp form YYYYMMDDTHHMMSSZ"
node_scope="${YNX_BOUNDED_REPLICATION_NODE_SCOPE:-all}"
[[ "$node_scope" == "all" || "$node_scope" == "primary" || "$node_scope" == "followers" ]] || fail "YNX_BOUNDED_REPLICATION_NODE_SCOPE must be all, primary, or followers"

primary_host="${PRIMARY_NODE_HOST:-}"
primary_user="${PRIMARY_NODE_USER:-}"
primary_key="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-}}"
singapore_host="${SG_NODE_HOST:-43.134.23.58}"
singapore_user="${SG_NODE_USER:-root}"
singapore_key="${SG_NODE_SSH_KEY:-$primary_key}"
silicon_host="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
silicon_user="${SILICON_VALLEY_NODE_USER:-ubuntu}"
silicon_key="${SILICON_VALLEY_NODE_SSH_KEY:-$primary_key}"
seoul_host="${SEOUL_NODE_HOST:-43.164.132.81}"
seoul_user="${SEOUL_NODE_USER:-root}"
seoul_key="${SEOUL_NODE_SSH_KEY:-$primary_key}"

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }

remote_exec() {
  local role="$1" user="$2" host="$3" key="$4" command="$5" remote="${user}@${host}"
  if [[ "$dry_run" == "1" ]]; then
    printf 'DRY RUN [%s] ssh -i %q %q %q\n' "$role" "$key" "$remote" "$command"
    return 0
  fi
  [[ -r "$key" ]] || fail "SSH key for ${role} is not readable"
  ynx_transport_ssh "${role} bounded-replication" "$key" "$remote" "$command"
}

upload_bundle() {
  local role="$1" user="$2" host="$3" key="$4" remote_bundle="$5" remote="${user}@${host}"
  if [[ "$dry_run" == "1" ]]; then
    printf 'DRY RUN [%s] upload %q to %q:%q\n' "$role" "$bundle" "$remote" "$remote_bundle"
    return 0
  fi
  [[ -r "$key" ]] || fail "SSH key for ${role} is not readable"
  ynx_transport_ssh "${role} bounded-replication upload" "$key" "$remote" "umask 077; cat > '${remote_bundle}'" <"$bundle"
}

preflight_node() {
  local role="$1" user="$2" host="$3" key="$4"
  echo "bounded replication recovery preflight: role=${role}"
  remote_exec "$role" "$user" "$host" "$key" "set -euo pipefail; systemctl is-active --quiet ynx-chaind; test -x /usr/local/bin/ynx-chaind; sudo test -r /etc/ynx/ynx-chaind.env; service_user=\$(systemctl show --property=User --value ynx-chaind); [[ \"\$service_user\" =~ ^[A-Za-z_][A-Za-z0-9_-]*\$ ]]; sudo -u \"\$service_user\" test -r /var/lib/ynx-chain/testnet/devnet-state.json; sudo -u \"\$service_user\" test -w /var/lib/ynx-chain/testnet/devnet-state.json; sudo -u \"\$service_user\" test -r /var/lib/ynx-chain/testnet/devnet-state.integrity-version; sudo -u \"\$service_user\" test -w /var/lib/ynx-chain/testnet/devnet-state.integrity-version; command -v tar >/dev/null; command -v sha256sum >/dev/null || command -v shasum >/dev/null; curl -fsS --max-time 8 http://127.0.0.1:6420/status >/dev/null; echo 'ynx-chaind preflight passed'"
}

install_node() {
  local role="$1" user="$2" host="$3" key="$4"
  local remote_bundle="/tmp/${release}-${role}.tar.gz"
  local remote_release="/opt/ynx-chain/releases/${release}"
  local backup="/var/backups/ynx-chain/${release}-${role}-${attempt_id}-ynx-chaind"
  local command
  upload_bundle "$role" "$user" "$host" "$key" "$remote_bundle"
  command="$(cat <<'REMOTE'
set -Eeuo pipefail
release='__RELEASE__'
remote_bundle='__REMOTE_BUNDLE__'
expected_bundle='__BUNDLE_SHA__'
expected_binary='__BINARY_SHA__'
expected_manifest='__MANIFEST_SHA__'
remote_release='__REMOTE_RELEASE__'
backup='__BACKUP__'
stage=$(mktemp -d /tmp/ynx-bounded-replication.XXXXXX)
installed=0
manifest_preexisting=0
rollback() {
  code=$?
  if [ "$installed" = 1 ] && sudo test -f "$backup/ynx-chaind"; then
    sudo install -m 0755 "$backup/ynx-chaind" /usr/local/bin/ynx-chaind
    sudo systemctl restart ynx-chaind || true
  fi
  if [ "$manifest_preexisting" = 0 ]; then
    sudo rm -f "$remote_release/config/release-manifest.json"
    sudo rmdir "$remote_release/config" "$remote_release" 2>/dev/null || true
  fi
  rm -rf "$stage"
  exit "$code"
}
trap rollback ERR
actual_bundle=$(sha256sum "$remote_bundle" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$remote_bundle" | awk '{print $1}')
[ "$actual_bundle" = "$expected_bundle" ]
tar -xzf "$remote_bundle" -C "$stage"
test -x "$stage/bin/ynx-chaind"
test -r "$stage/config/release-manifest.json"
actual_binary=$(sha256sum "$stage/bin/ynx-chaind" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$stage/bin/ynx-chaind" | awk '{print $1}')
actual_manifest=$(sha256sum "$stage/config/release-manifest.json" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$stage/config/release-manifest.json" | awk '{print $1}')
[ "$actual_binary" = "$expected_binary" ]
[ "$actual_manifest" = "$expected_manifest" ]
sudo test ! -e "$backup"
sudo install -d -m 0700 "$backup"
sudo install -m 0755 /usr/local/bin/ynx-chaind "$backup/ynx-chaind"
# The backup directory is intentionally root-only. Elevate the output writer,
# not just the checksum command, so the caller shell never owns this write.
(sha256sum /usr/local/bin/ynx-chaind 2>/dev/null || shasum -a 256 /usr/local/bin/ynx-chaind) | sudo tee "$backup/ynx-chaind.sha256" >/dev/null
sudo install -d -m 0755 "$remote_release/config"
if sudo test -f "$remote_release/config/release-manifest.json"; then
  existing_manifest=$(sudo sha256sum "$remote_release/config/release-manifest.json" 2>/dev/null | awk '{print $1}' || sudo shasum -a 256 "$remote_release/config/release-manifest.json" | awk '{print $1}')
  [ "$existing_manifest" = "$expected_manifest" ]
  existing_binary=$(sudo sha256sum /usr/local/bin/ynx-chaind 2>/dev/null | awk '{print $1}' || sudo shasum -a 256 /usr/local/bin/ynx-chaind | awk '{print $1}')
  if [ "$existing_binary" = "$expected_binary" ]; then
    rm -rf "$stage"
    trap - ERR
    echo "bounded replication release already active: role=__ROLE__ release=$release binarySha256=$existing_binary"
    exit 0
  fi
fi
sudo install -m 0644 "$stage/config/release-manifest.json" "$remote_release/config/release-manifest.json"
sudo install -m 0755 "$stage/bin/ynx-chaind" /usr/local/bin/ynx-chaind.next
sudo mv /usr/local/bin/ynx-chaind.next /usr/local/bin/ynx-chaind
installed=1
sudo systemctl restart ynx-chaind
ready=0
for attempt in $(seq 1 20); do
  if systemctl is-active --quiet ynx-chaind && curl -fsS --max-time 3 http://127.0.0.1:6420/status >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ]
running_binary=$(sudo sha256sum /usr/local/bin/ynx-chaind 2>/dev/null | awk '{print $1}' || sudo shasum -a 256 /usr/local/bin/ynx-chaind | awk '{print $1}')
[ "$running_binary" = "$expected_binary" ]
rm -rf "$stage"
trap - ERR
echo "bounded replication release installed: role=__ROLE__ release=$release binarySha256=$running_binary"
REMOTE
)"
  command="${command//__RELEASE__/$release}"
  command="${command//__REMOTE_BUNDLE__/$remote_bundle}"
  command="${command//__BUNDLE_SHA__/$expected_bundle_sha}"
  command="${command//__BINARY_SHA__/$binary_sha}"
  command="${command//__MANIFEST_SHA__/$manifest_sha}"
  command="${command//__REMOTE_RELEASE__/$remote_release}"
  command="${command//__BACKUP__/$backup}"
  command="${command//__ROLE__/$role}"
  remote_exec "$role" "$user" "$host" "$key" "$command"
}

[[ -f "$bundle" ]] || fail "candidate bundle not found: $bundle"
[[ "$expected_bundle_sha" =~ ^[0-9a-f]{64}$ ]] || fail "YNX_BOUNDED_REPLICATION_BUNDLE_SHA256 must be an exact SHA-256 digest"
[[ "$(sha256_file "$bundle")" == "$expected_bundle_sha" ]] || fail "local candidate bundle digest mismatch"
node scripts/verify/release-manifest-check.mjs "$release_dir" "$release_short" "$release" >/dev/null
binary_sha="$(sha256_file "$release_dir/bin/ynx-chaind")"
manifest_sha="$(sha256_file "$release_dir/config/release-manifest.json")"

for value in "$primary_host" "$primary_user" "$primary_key" "$singapore_host" "$singapore_user" "$singapore_key" "$silicon_host" "$silicon_user" "$silicon_key" "$seoul_host" "$seoul_user" "$seoul_key"; do [[ -n "$value" ]] || fail "all four node host, user and SSH-key inputs are required"; done
if [[ "$mode" == "--deploy" && "$dry_run" != "1" && "${YNX_BOUNDED_REPLICATION_DEPLOY:-}" != "yes" ]]; then
  fail "set YNX_BOUNDED_REPLICATION_DEPLOY=yes only after the protected deployment gate accepts this exact candidate"
fi
if [[ "$mode" == "--deploy" && "$dry_run" != "1" && "${YNX_BOUNDED_REPLICATION_GATE_COMMIT:-}" != "$candidate_commit" ]]; then
  fail "YNX_BOUNDED_REPLICATION_GATE_COMMIT must bind the accepted protected gate to ${candidate_commit}"
fi

echo "bounded replication recovery plan: toolingCommit=${candidate_commit} releaseCommit=${release_commit} release=${release} bundleSha256=${expected_bundle_sha}"
echo "scope: existing ynx-chaind binary plus source-bound release manifest only; units, environment, chain state and other services are preserved"
echo "node scope: ${node_scope}; every selected node is preflighted before its binary is replaced"

# A legacy primary can emit an unbounded historical suffix. Upgrade it alone
# before followers, so its new endpoint establishes the bounded transport
# contract without restarting or mutating a follower during this transition.
if [[ "$node_scope" == "all" || "$node_scope" == "followers" ]]; then
  preflight_node singapore "$singapore_user" "$singapore_host" "$singapore_key"
  preflight_node silicon-valley "$silicon_user" "$silicon_host" "$silicon_key"
  preflight_node seoul "$seoul_user" "$seoul_host" "$seoul_key"
fi
if [[ "$node_scope" == "all" || "$node_scope" == "primary" ]]; then
  preflight_node primary "$primary_user" "$primary_host" "$primary_key"
fi
if [[ "$mode" == "--preflight" ]]; then
  echo "bounded replication recovery preflight passed; no node was altered"
  exit 0
fi
if [[ "$node_scope" == "primary" ]]; then
  install_node primary "$primary_user" "$primary_host" "$primary_key"
elif [[ "$node_scope" == "followers" ]]; then
  install_node singapore "$singapore_user" "$singapore_host" "$singapore_key"
  install_node silicon-valley "$silicon_user" "$silicon_host" "$silicon_key"
  install_node seoul "$seoul_user" "$seoul_host" "$seoul_key"
else
  # Primary first is intentional: it establishes byte-bounded batches before
  # any follower is restarted. No two nodes are restarted concurrently.
  install_node primary "$primary_user" "$primary_host" "$primary_key"
  install_node singapore "$singapore_user" "$singapore_host" "$singapore_key"
  install_node silicon-valley "$silicon_user" "$silicon_host" "$silicon_key"
  install_node seoul "$seoul_user" "$seoul_host" "$seoul_key"
fi
if [[ "$dry_run" == "1" ]]; then
  echo "bounded replication recovery dry run passed; no node was altered"
else
  echo "bounded replication recovery completed for all four nodes"
fi
