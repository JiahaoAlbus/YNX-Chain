#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/ops/lib.sh
ynx_ops_init

action="${1:-rehearse}"
[[ "$action" == "rehearse" || "$action" == "preflight" ]] || {
  echo "production driver phase $action is not implemented; public cutover remains blocked" >&2
  exit 64
}
[[ "$(git branch --show-current)" == "main" ]] || { echo "production rehearsal requires main branch" >&2; exit 1; }
[[ -z "$(git status --short --untracked-files=no)" ]] || { echo "production rehearsal requires no tracked worktree changes" >&2; exit 1; }

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"
run_id="${PUBLIC_BFT_PRODUCTION_REHEARSAL_ID:-rehearsal-${commit}-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || { echo "invalid production rehearsal id" >&2; exit 1; }
root="${PUBLIC_BFT_PRODUCTION_REHEARSAL_DIR:-tmp/public-bft-production-rehearsal}/${run_id}"
[[ ! -e "$root" ]] || { echo "production rehearsal evidence already exists: $root" >&2; exit 1; }
umask 077
mkdir -p "$root/roles" "$root/prebuilt"

cleanup_failed() {
  local status="$?"
  if [[ "$status" != "0" ]]; then
    printf '{"status":"failed","commit":"%s","release":"%s","at":"%s"}\n' "$commit" "$release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/result.json"
    echo "production rehearsal failed; no remote mutation was requested; evidence=$root" >&2
  fi
  exit "$status"
}
trap cleanup_failed EXIT

for target in ynx-abci ynx-bft-gatewayd ynx-consensus-keycheck; do
  package="./cmd/$target"
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$root/prebuilt/$target" "$package"
done
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$root/prebuilt/cometbft" github.com/cometbft/cometbft/cmd/cometbft
shasum -a 256 "$root"/prebuilt/* >"$root/prebuilt.sha256"

collect_role() {
  local role="$1" user="$2" host="$3" key="$4" kind="$5"
  local role_dir="$root/roles/$role" validator services
  mkdir -p "$role_dir"
  case "$role" in
    primary) validator=ynx_validator_primary ;;
    singapore) validator=ynx_validator_singapore ;;
    silicon-valley) validator=ynx_validator_silicon_valley ;;
    seoul) validator=ynx_validator_seoul ;;
  esac
  services="$(ynx_ops_services_for_kind "$kind")"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/status" >"$role_dir/status.json"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -eu; manifest=/opt/ynx-chain/releases/$release/config/release-manifest.json; for service in $services; do systemctl is-active \"\$service\" >/dev/null; done; systemctl is-active ynx-consensus-overlay.service >/dev/null; ip link show ynxwg0 >/dev/null; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate)\" = 750; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_key.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/priv_validator_state.json)\" = 600; test \"\$(sudo stat -c %a /etc/ynx/consensus-candidate/$role/node_key.json)\" = 600; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service; ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$'; sudo test ! -e /var/lib/ynx-chain/mutation-freeze.json; sudo test -d '${BACKUP_STORAGE_PATH:-/var/backups/ynx-chain}'; test \"\$(df -Pk /var/lib/ynx-chain | awk 'NR==2 {print \$4}')\" -gt 2097152; test -f \"\$manifest\"; printf 'role=%s\\nvalidator=%s\\nrelease=%s\\nservices=active\\noverlay=active\\nkeys=restricted\\ncandidate=absent\\nfreeze=absent\\nports=free\\ndisk=ready\\nbackup=present\\nmanifest_sha256=' '$role' '$validator' '$release'; sha256sum \"\$manifest\" | awk '{print \$1}'" >"$role_dir/preflight.txt"
}
ynx_ops_each_node collect_role

height="$(node -e 'const fs=require("fs"),p=process.argv[1],roles=["primary","singapore","silicon-valley","seoul"]; const h=roles.map(r=>Number(JSON.parse(fs.readFileSync(`${p}/roles/${r}/status.json`)).height)); if(h.some(v=>!Number.isSafeInteger(v)||v<3)) process.exit(1); process.stdout.write(String(Math.min(...h)-2));' "$root")"
printf '%s\n' "$height" >"$root/convergence-height.txt"

collect_block() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "curl -fsS http://127.0.0.1:6420/blocks/$height" >"$root/roles/$role/block.json"
}
ynx_ops_each_node collect_block

node scripts/verify/validate-public-bft-production-rehearsal.mjs "$root" "$commit" "$release" >"$root/validation.json"
printf '{"status":"passed","commit":"%s","release":"%s","height":%s,"at":"%s","remoteMutation":false,"publicIngressChanged":false}\n' "$commit" "$release" "$height" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/result.json"
trap - EXIT
echo "production BFT rehearsal passed without remote mutation: evidence=$root"
