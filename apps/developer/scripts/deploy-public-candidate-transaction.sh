#!/usr/bin/env bash
set -euo pipefail

# Run on the reviewed Linux host from a clean clone of the exact pushed source.
# This transaction never changes Caddy, Wallet, Chain or another product tree.

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd "$script_dir/../../.." && pwd)
expected_commit="${YNX_CODE_DEPLOY_COMMIT:?Set YNX_CODE_DEPLOY_COMMIT to the exact 40-hex pushed commit}"
package_network="${YNX_CODE_LXD_PACKAGE_NETWORK:?Set YNX_CODE_LXD_PACKAGE_NETWORK to the reviewed package-egress LXD network}"
package_acl="ynx-code-package-egress-acl"
service="${YNX_CODE_DEPLOY_SERVICE:-ynx-code-candidate.service}"
candidate_root="${YNX_CODE_CANDIDATE_ROOT:-/opt/ynx-developer/candidates}"
state_dir="${YNX_CODE_STATE_DIR:-/var/lib/ynx-code-candidate}"
env_file="${YNX_CODE_ENV_FILE:-/etc/ynx/ynx-code-candidate.env}"
evidence_root="${YNX_CODE_DEPLOY_EVIDENCE_ROOT:-/var/lib/ynx-code-candidate/deploy-evidence}"
short_commit=${expected_commit:0:12}
candidate_dir="$candidate_root/$expected_commit"
current_link="$candidate_root/current"
image_alias="ynx-code-ubuntu-24.04-toolchain-$short_commit"
release="0.2.0-testnet-preview-$short_commit-candidate"
transaction_id="$(date -u +%Y%m%dT%H%M%SZ)-$short_commit"
transaction_dir="$evidence_root/$transaction_id"
staging_dir="$candidate_root/.staging-$transaction_id"
package_probe_state="$state_dir/.package-persistence-probe-$transaction_id"
rollback_dir="/run/ynx-code-deploy-$transaction_id"
backup_tar="$rollback_dir/state-before.tar"
env_backup="$rollback_dir/ynx-code-candidate.env.before"
unit_backup="$rollback_dir/ynx-code-candidate.service.before"
previous_target=""
switched=false
stopped=false
candidate_installed=false
image_created=false
completed=false

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"; }
assert_package_egress_detached() {
  local evidence_file=$1
  lxc query '/1.0/instances?recursion=1' > "$evidence_file"
  node - "$evidence_file" <<'NODE'
const fs=require("node:fs"),value=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),instances=Array.isArray(value)?value:value?.metadata;
if(!Array.isArray(instances))throw new Error("LXD instance inventory is invalid");
for(const instance of instances){
  const devices={...(instance.devices||{}),...(instance.expanded_devices||{})};
  if(Object.hasOwn(devices,"ynx-package-egress"))throw new Error(`Temporary package egress remains attached to ${instance.name||"an instance"}`);
}
NODE
}
cleanup_staging() {
  if [[ -d $staging_dir ]]; then
    find "$staging_dir" -depth -delete
  fi
  if [[ $candidate_installed == true && $switched == false && -d $candidate_dir ]]; then
    find "$candidate_dir" -depth -delete
  fi
  if [[ -d $rollback_dir ]]; then
    find "$rollback_dir" -depth -delete
  fi
  if [[ $completed == false && $image_created == true && $image_fingerprint =~ ^[0-9a-f]{64}$ ]]; then
    lxc image delete "$image_fingerprint" >/dev/null 2>&1 || true
  fi
}
trap cleanup_staging EXIT

[[ $expected_commit =~ ^[0-9a-f]{40}$ ]] || fail "YNX_CODE_DEPLOY_COMMIT must be 40 lowercase hex characters"
[[ $package_network =~ ^[A-Za-z0-9_.-]{1,80}$ ]] || fail "YNX_CODE_LXD_PACKAGE_NETWORK must be a valid LXD network name"
[[ $package_network == ynx-pkg-egress ]] || fail "YNX_CODE_LXD_PACKAGE_NETWORK does not match the reviewed production network"
[[ $candidate_root == /opt/ynx-developer/candidates ]] || fail "candidate root is outside the reviewed boundary"
[[ $state_dir == /var/lib/ynx-code-candidate ]] || fail "state directory is outside the reviewed boundary"
[[ $env_file == /etc/ynx/ynx-code-candidate.env ]] || fail "environment file is outside the reviewed boundary"
[[ $evidence_root == "$state_dir/deploy-evidence" ]] || fail "evidence directory is outside the reviewed state boundary"
[[ $(id -u) -eq 0 ]] || fail "run as root on the reviewed candidate host"

for tool in git node npm lxc systemctl tar sha256sum install; do require "$tool"; done
runuser_bin=/usr/sbin/runuser
[[ -x $runuser_bin ]] || fail "reviewed runuser binary is missing: $runuser_bin"
cd "$repo_dir"
git_safe=(git -c "safe.directory=$repo_dir")
"${git_safe[@]}" fetch --prune origin codex/ynx-code-platform-v1
[[ $("${git_safe[@]}" rev-parse HEAD) == "$expected_commit" ]] || fail "checkout does not match the approved commit"
[[ -z $("${git_safe[@]}" status --porcelain=v1 --untracked-files=normal) ]] || fail "source checkout is dirty"
"${git_safe[@]}" merge-base --is-ancestor "$expected_commit" origin/codex/ynx-code-platform-v1 || fail "commit is not on the reviewed remote branch"
expected_tree=$("${git_safe[@]}" rev-parse "$expected_commit^{tree}")
[[ $expected_tree =~ ^[0-9a-f]{40}$ ]] || fail "commit did not resolve to an exact Git tree"
[[ ! -e $candidate_dir ]] || fail "immutable candidate directory already exists: $candidate_dir"
[[ ! -e $staging_dir ]] || fail "candidate staging directory already exists: $staging_dir"
[[ -f $env_file ]] || fail "candidate environment file is missing"
[[ -d $state_dir ]] || fail "candidate state directory is missing"

install -d -m 0700 "$transaction_dir"
install -d -m 0700 "$rollback_dir"
lxc query "/1.0/networks/$package_network" > "$transaction_dir/lxd-package-network.json"
lxc query "/1.0/network-acls/$package_acl" > "$transaction_dir/lxd-package-network-acl.json"
node "$repo_dir/apps/developer/scripts/verify-package-egress-network.mjs" \
  --network "$transaction_dir/lxd-package-network.json" \
  --acl "$transaction_dir/lxd-package-network-acl.json" \
  > "$transaction_dir/lxd-package-network-review.json"
"${git_safe[@]}" status --short --branch > "$transaction_dir/source-status.txt"
"${git_safe[@]}" show -s --format=fuller "$expected_commit" > "$transaction_dir/source-commit.txt"
install -d -o ubuntu -g ubuntu -m 0755 "$staging_dir"
"${git_safe[@]}" archive --format=tar "$expected_commit" | tar -xf - -C "$staging_dir"
chown -R ubuntu:ubuntu "$staging_dir"

"$runuser_bin" -u ubuntu -- bash -lc "cd '$staging_dir/apps/developer' && bash scripts/install-reviewed-dependencies.sh"
"$runuser_bin" -u ubuntu -- bash -lc "cd '$staging_dir/apps/developer' && npm run code:check && npm run code:build && npm test"

image_output=$(YNX_CODE_TARGET_IMAGE="$image_alias" "$staging_dir/apps/developer/scripts/build-cloud-toolchain-image.sh")
image_fingerprint=$(printf '%s\n' "$image_output" | awk -F= '/^YNX_CODE_LXD_IMAGE=/{print $2}')
[[ $image_fingerprint =~ ^[0-9a-f]{64}$ ]] || fail "image builder did not return an immutable fingerprint"
image_created=true
lxc image info "$image_fingerprint" > "$transaction_dir/lxd-image-info.txt"
mv "$staging_dir" "$candidate_dir"
candidate_installed=true
chown -R ubuntu:ubuntu "$candidate_dir"

previous_target=$(readlink -f "$current_link")
[[ $previous_target == "$candidate_root/"* ]] || fail "current candidate symlink resolves outside the reviewed root"
cp -a "$env_file" "$env_backup"
cp -a "/etc/systemd/system/$service" "$unit_backup"

rollback() {
  status=$?
  trap - ERR EXIT HUP INT TERM
  # The success path removes this trap.  Any remaining exit, including a
  # disconnected SSH session (HUP), must restore the prior public candidate.
  if [[ $status -eq 0 ]]; then status=1; fi
  if [[ $status -ne 0 ]]; then
    printf 'Deployment gate failed; restoring prior candidate.\n' >&2
    if [[ $stopped == false ]]; then systemctl stop "$service" || true; fi
    stopped=true
    if [[ $switched == true ]]; then ln -sfn "$previous_target" "$current_link"; fi
    cp -a "$env_backup" "$env_file" || true
    cp -a "$unit_backup" "/etc/systemd/system/$service" || true
    if [[ -f $backup_tar ]]; then
      expected_backup_sha=$(awk 'NR==1{print $1}' "$transaction_dir/state-before.sha256")
      actual_backup_sha=$(sha256sum "$backup_tar" | awk '{print $1}')
      [[ $actual_backup_sha == "$expected_backup_sha" ]] || printf 'WARNING: pre-deploy state snapshot integrity check failed.\n' >&2
    fi
    if [[ $candidate_installed == true && -d $candidate_dir ]]; then
      find "$candidate_dir" -depth -delete || true
    elif [[ -d $staging_dir ]]; then
      find "$staging_dir" -depth -delete || true
    fi
    systemctl daemon-reload || true
    systemctl start "$service" || true
    if [[ -f $package_probe_state ]]; then
      YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 YNX_CODE_CHECK_STATE="$package_probe_state" \
        node "$repo_dir/apps/developer/scripts/live-package-install-check.mjs" cleanup || true
    fi
    printf 'rolled-back\n' > "$transaction_dir/result.txt"
    cleanup_staging
  fi
  exit "$status"
}
trap rollback ERR EXIT HUP INT TERM

systemctl stop "$service"
stopped=true
tar -C "$state_dir" --exclude=deploy-evidence -cpf "$backup_tar" .
sha256sum "$backup_tar" | sed "s#$backup_tar#state-before.tar#" > "$transaction_dir/state-before.sha256"

node - "$env_file" "$image_fingerprint" "$release" "$package_network" "$expected_commit" "$expected_tree" <<'NODE'
const fs=require("node:fs"),[file,image,release,packageNetwork,sourceCommit,sourceTree]=process.argv.slice(2),lines=fs.readFileSync(file,"utf8").split(/\r?\n/),updates=new Map([["YNX_CODE_LXD_IMAGE",image],["YNX_CODE_RELEASE",release],["YNX_CODE_LXD_PACKAGE_NETWORK",packageNetwork],["YNX_CODE_SOURCE_COMMIT",sourceCommit],["YNX_CODE_SOURCE_TREE",sourceTree]]),seen=new Set(),output=[];
if(!/^[0-9a-f]{40}$/.test(sourceCommit)||!/^[0-9a-f]{40}$/.test(sourceTree))throw new Error("source identity must use exact lowercase Git objects");
for(const line of lines){const match=line.match(/^([A-Z][A-Z0-9_]*)=/);if(match&&updates.has(match[1])){output.push(`${match[1]}=${updates.get(match[1])}`);seen.add(match[1]);}else if(line)output.push(line)}
for(const[key,value]of updates)if(!seen.has(key))output.push(`${key}=${value}`);
fs.writeFileSync(file,`${output.join("\n")}\n`,{mode:0o600});
NODE

install -m 0644 "$candidate_dir/apps/developer/deploy/systemd/ynx-code-candidate.service" "/etc/systemd/system/$service"
ln -sfn "$candidate_dir" "$current_link"
switched=true
systemctl daemon-reload
systemctl start "$service"
stopped=false

for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:18113/healthz > "$transaction_dir/health.json"; then break; fi
  sleep 1
done
node -e 'const fs=require("node:fs"),v=JSON.parse(fs.readFileSync(process.argv[1]));if(!v.ok||v.version!==process.argv[2]||v.sourceCommit!==process.argv[3]||v.sourceTree!==process.argv[4])process.exit(1)' "$transaction_dir/health.json" "$release" "$expected_commit" "$expected_tree"

cd "$candidate_dir/apps/developer"
run_cloud_container_gate() {
  YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 node scripts/live-container-check.mjs | tee "$1"
}
if ! run_cloud_container_gate "$transaction_dir/live-container.log"; then
  printf '%s\n' 'Cloud runtime gate failed once; retrying from a fresh isolated runtime.' | tee "$transaction_dir/live-container-retry-notice.log"
  if ! run_cloud_container_gate "$transaction_dir/live-container-retry.log"; then
    fail 'Cloud runtime gate failed in both fresh isolated runtime attempts.'
  fi
fi
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 node scripts/live-chain-tools-check.mjs | tee "$transaction_dir/live-chain.log"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 node scripts/live-wallet-readiness-check.mjs | tee "$transaction_dir/live-wallet.log"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 node scripts/live-public-candidate-check.mjs | tee "$transaction_dir/live-public.log"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 YNX_CODE_CHECK_STATE="$package_probe_state" node scripts/live-package-install-check.mjs prepare | tee "$transaction_dir/package-prepare.log"
assert_package_egress_detached "$transaction_dir/package-devices-after-install.json"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 YNX_CODE_CHECK_STATE="$state_dir/.persistence-probe-$transaction_id" node scripts/live-public-candidate-check.mjs prepare | tee "$transaction_dir/restart-prepare.log"
systemctl restart "$service"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:18113/healthz > "$transaction_dir/health-after-restart.json"; then break; fi
  sleep 1
done
node -e 'const fs=require("node:fs"),v=JSON.parse(fs.readFileSync(process.argv[1]));if(!v.ok||v.version!==process.argv[2]||v.sourceCommit!==process.argv[3]||v.sourceTree!==process.argv[4])process.exit(1)' "$transaction_dir/health-after-restart.json" "$release" "$expected_commit" "$expected_tree"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 YNX_CODE_CHECK_STATE="$state_dir/.persistence-probe-$transaction_id" node scripts/live-public-candidate-check.mjs resume | tee "$transaction_dir/restart-resume.log"
YNX_CODE_CHECK_BASE=http://127.0.0.1:18113 YNX_CODE_CHECK_STATE="$package_probe_state" node scripts/live-package-install-check.mjs resume | tee "$transaction_dir/package-resume.log"
assert_package_egress_detached "$transaction_dir/package-devices-after-restart.json"

systemctl is-active --quiet "$service"
curl -fsS --max-time 10 https://developer.ynxweb4.com/healthz > "$transaction_dir/public-health.json"
node -e 'const fs=require("node:fs"),v=JSON.parse(fs.readFileSync(process.argv[1]));if(!v.ok||v.version!==process.argv[2]||v.sourceCommit!==process.argv[3]||v.sourceTree!==process.argv[4])process.exit(1)' "$transaction_dir/public-health.json" "$release" "$expected_commit" "$expected_tree"
printf '%s\n' "$image_fingerprint" > "$transaction_dir/image-fingerprint.txt"
printf 'passed\n' > "$transaction_dir/result.txt"
sha256sum "$transaction_dir"/*.json "$transaction_dir"/*.log "$transaction_dir"/*.txt > "$transaction_dir/evidence-sha256.txt"
find "$rollback_dir" -depth -delete
completed=true
trap - ERR EXIT HUP INT TERM
printf 'YNX Code candidate deployed: %s\nImage: %s\nEvidence: %s\n' "$expected_commit" "$image_fingerprint" "$transaction_dir"
