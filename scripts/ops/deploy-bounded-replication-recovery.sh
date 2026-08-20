#!/usr/bin/env bash
# Deploy only the source-bound ynx-chaind binary needed for the bounded
# replication repair. It deliberately never calls the full-stack deployment.
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh

candidate_commit="$(git rev-parse HEAD)"
candidate_short="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${candidate_short}"
bundle="${YNX_BOUNDED_REPLICATION_BUNDLE:-tmp/deploy/${release}.tar.gz}"
expected_bundle_sha="${YNX_BOUNDED_REPLICATION_BUNDLE_SHA256:-}"
dry_run="${DEPLOY_DRY_RUN:-0}"

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

fail() { echo "bounded replication recovery: $*" >&2; exit 1; }
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
  remote_exec "$role" "$user" "$host" "$key" "set -euo pipefail; systemctl is-active --quiet ynx-chaind; test -x /usr/local/bin/ynx-chaind; test -r /etc/ynx/ynx-chaind.env; command -v tar >/dev/null; command -v sha256sum >/dev/null || command -v shasum >/dev/null; curl -fsS --max-time 8 http://127.0.0.1:6420/status >/dev/null; echo 'ynx-chaind preflight passed'"
}

install_node() {
  local role="$1" user="$2" host="$3" key="$4"
  local remote_bundle="/tmp/${release}-${role}.tar.gz"
  local remote_release="/opt/ynx-chain/releases/${release}"
  local backup="/var/backups/ynx-chain/${release}-${role}-ynx-chaind"
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
rollback() {
  code=$?
  if [ "$installed" = 1 ] && sudo test -f "$backup/ynx-chaind"; then
    sudo install -m 0755 "$backup/ynx-chaind" /usr/local/bin/ynx-chaind
    sudo systemctl restart ynx-chaind || true
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
sudo sh -c "sha256sum /usr/local/bin/ynx-chaind 2>/dev/null || shasum -a 256 /usr/local/bin/ynx-chaind" > "$backup/ynx-chaind.sha256"
sudo install -d -m 0755 "$remote_release/config"
if sudo test -f "$remote_release/config/release-manifest.json"; then
  existing_manifest=$(sudo sha256sum "$remote_release/config/release-manifest.json" 2>/dev/null | awk '{print $1}' || sudo shasum -a 256 "$remote_release/config/release-manifest.json" | awk '{print $1}')
  [ "$existing_manifest" = "$expected_manifest" ]
fi
sudo install -m 0644 "$stage/config/release-manifest.json" "$remote_release/config/release-manifest.json"
sudo install -m 0755 "$stage/bin/ynx-chaind" /usr/local/bin/ynx-chaind.next
sudo mv /usr/local/bin/ynx-chaind.next /usr/local/bin/ynx-chaind
installed=1
sudo systemctl restart ynx-chaind
sleep 2
systemctl is-active --quiet ynx-chaind
curl -fsS --max-time 12 http://127.0.0.1:6420/status >/dev/null
rm -rf "$stage"
trap - ERR
echo "bounded replication release installed: role=__ROLE__ release=$release binarySha256=$actual_binary"
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
node scripts/verify/release-manifest-check.mjs "tmp/deploy/${release}" "$candidate_short" "$release" >/dev/null
binary_sha="$(sha256_file "tmp/deploy/${release}/bin/ynx-chaind")"
manifest_sha="$(sha256_file "tmp/deploy/${release}/config/release-manifest.json")"

for value in "$primary_host" "$primary_user" "$primary_key" "$singapore_host" "$singapore_user" "$singapore_key" "$silicon_host" "$silicon_user" "$silicon_key" "$seoul_host" "$seoul_user" "$seoul_key"; do [[ -n "$value" ]] || fail "all four node host, user and SSH-key inputs are required"; done
if [[ "$dry_run" != "1" && "${YNX_BOUNDED_REPLICATION_DEPLOY:-}" != "yes" ]]; then
  fail "set YNX_BOUNDED_REPLICATION_DEPLOY=yes only after the protected deployment gate accepts this exact candidate"
fi
if [[ "$dry_run" != "1" && "${YNX_BOUNDED_REPLICATION_GATE_COMMIT:-}" != "$candidate_commit" ]]; then
  fail "YNX_BOUNDED_REPLICATION_GATE_COMMIT must bind the accepted protected gate to ${candidate_commit}"
fi

echo "bounded replication recovery plan: commit=${candidate_commit} release=${release} bundleSha256=${expected_bundle_sha}"
echo "scope: existing ynx-chaind binary plus source-bound release manifest only; units, environment, chain state and other services are preserved"

# Followers first, then the primary. No two nodes are restarted concurrently.
preflight_node singapore "$singapore_user" "$singapore_host" "$singapore_key"
preflight_node silicon-valley "$silicon_user" "$silicon_host" "$silicon_key"
preflight_node seoul "$seoul_user" "$seoul_host" "$seoul_key"
preflight_node primary "$primary_user" "$primary_host" "$primary_key"
install_node singapore "$singapore_user" "$singapore_host" "$singapore_key"
install_node silicon-valley "$silicon_user" "$silicon_host" "$silicon_key"
install_node seoul "$seoul_user" "$seoul_host" "$seoul_key"
install_node primary "$primary_user" "$primary_host" "$primary_key"
if [[ "$dry_run" == "1" ]]; then
  echo "bounded replication recovery dry run passed; no node was altered"
else
  echo "bounded replication recovery completed for all four nodes"
fi
