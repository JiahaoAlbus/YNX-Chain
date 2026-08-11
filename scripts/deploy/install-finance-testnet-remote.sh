#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing release directory}"
source_commit="${2:?missing source commit}"
release="${3:?missing release name}"
build_time="${4:?missing build time}"
binary_sha="${5:?missing binary digest}"
web_sha="${6:?missing web digest}"

[[ "$(id -u)" == "0" ]] || { echo "Finance installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "source commit must be a full lowercase Git SHA" >&2; exit 1; }
[[ "$release" == "ynx-finance-${source_commit:0:12}" ]] || { echo "release does not match source commit" >&2; exit 1; }
[[ "$build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || { echo "build time is invalid" >&2; exit 1; }
[[ "$binary_sha" =~ ^[0-9a-f]{64}$ && "$web_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "release digest is invalid" >&2; exit 1; }
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is missing or unsafe" >&2; exit 1; }
for command in curl node runuser sha256sum systemctl; do command -v "$command" >/dev/null; done
id -u ynx >/dev/null
[[ "$(sha256sum "$release_dir/ynx-finance" | awk '{print $1}')" == "$binary_sha" ]] || { echo "Finance binary digest mismatch" >&2; exit 1; }
actual_web_sha="$(cd "$release_dir/web" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
[[ "$actual_web_sha" == "$web_sha" ]] || { echo "Finance web digest mismatch" >&2; exit 1; }

env_file=/etc/ynx/finance.env
service=ynx-finance.service
state_dir=/var/lib/ynx/finance
current=/opt/ynx/finance-current
[[ -f "$env_file" ]] || { echo "Finance environment is missing" >&2; exit 1; }
install -d -o ynx -g ynx -m 0700 "$state_dir"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
for key in YNX_FINANCE_CURSOR_SIGNING_KEY YNX_FINANCE_OPERATIONS_KEY YNX_FINANCE_INTERNAL_KEY YNX_FINANCE_WALLET_GATEWAY_URL; do [[ -n "${!key:-}" ]] || { echo "$key is missing" >&2; exit 1; }; done

preflight_state="$state_dir/.preflight-$release.json"
preflight_log="/tmp/$release-preflight.log"
rm -f "$preflight_state" "$preflight_log"
export YNX_FINANCE_LISTEN=127.0.0.1:16483 YNX_FINANCE_STATE_PATH="$preflight_state" YNX_FINANCE_WEB_DIR="$release_dir/web"
runuser -u ynx --preserve-environment -- "$release_dir/ynx-finance" >"$preflight_log" 2>&1 &
preflight_pid=$!
cleanup_preflight() { kill "$preflight_pid" 2>/dev/null || true; wait "$preflight_pid" 2>/dev/null || true; rm -f "$preflight_state" "$preflight_log"; }
trap cleanup_preflight EXIT
preflight_ok=0
for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 2 http://127.0.0.1:16483/health 2>/dev/null)" && version="$(curl -fsS --max-time 2 http://127.0.0.1:16483/version 2>/dev/null)" && renderer="$(curl -fsS --max-time 2 http://127.0.0.1:16483/read-sources.js 2>/dev/null)"; then
    if HEALTH="$health" VERSION="$version" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" node <<'NODE'
const h=JSON.parse(process.env.HEALTH),v=JSON.parse(process.env.VERSION);
if(!h.ok||h.service!=="ynx-finance"||h.chainId!=="ynx_6423-1"||h.custody!=="none"||h.portfolio!=="read-only")process.exit(1);
if(v.commit!==process.env.EXPECTED_COMMIT||v.release!==process.env.EXPECTED_RELEASE||h.build.commit!==v.commit||h.build.release!==v.release)process.exit(1);
NODE
    then
      grep -Fq 'const dexDetails=' <<<"$renderer" || { echo "Finance DEX renderer is missing" >&2; exit 1; }
      preflight_ok=1
      break
    fi
  fi
  sleep 1
done
[[ "$preflight_ok" == "1" ]] || { tail -80 "$preflight_log" >&2; exit 1; }
cleanup_preflight
trap - EXIT

backup="/var/backups/ynx-finance/$(date -u +%Y%m%dT%H%M%SZ)-pre-$release"
install -d -o root -g root -m 0700 "$backup"
cp -a "$env_file" "$backup/finance.env"
old_target="$(readlink "$current" 2>/dev/null || true)"
printf '%s\n' "$old_target" >"$backup/previous-target"
new_env="/etc/ynx/.finance.env.$release"
awk '!/^YNX_FINANCE_WEB_DIR=/' "$env_file" >"$new_env"
printf 'YNX_FINANCE_WEB_DIR=%s/web\n' "$release_dir" >>"$new_env"
chown root:ynx "$new_env"
chmod 0640 "$new_env"

rollback_required=1
rollback() {
  if [[ "$rollback_required" == "1" ]]; then
    cp -a "$backup/finance.env" "$env_file"
    if [[ -n "$old_target" ]]; then ln -sfn "$old_target" "$current.rollback"; mv -Tf "$current.rollback" "$current"; fi
    systemctl daemon-reload
    systemctl restart "$service" || true
  fi
}
trap rollback EXIT
mv -f "$new_env" "$env_file"
ln -sfn "$release_dir" "$current.next"
mv -Tf "$current.next" "$current"
systemctl daemon-reload
systemctl restart "$service"
for _ in $(seq 1 30); do
  health="$(curl -fsS --max-time 2 http://127.0.0.1:6483/health 2>/dev/null || true)"
  version="$(curl -fsS --max-time 2 http://127.0.0.1:6483/version 2>/dev/null || true)"
  if HEALTH="$health" VERSION="$version" EXPECTED_COMMIT="$source_commit" EXPECTED_RELEASE="$release" node -e 'const h=JSON.parse(process.env.HEALTH),v=JSON.parse(process.env.VERSION);if(!h.ok||v.commit!==process.env.EXPECTED_COMMIT||v.release!==process.env.EXPECTED_RELEASE||h.build.commit!==v.commit)process.exit(1)' 2>/dev/null; then
    rollback_required=0
    trap - EXIT
    printf 'financeDeploy=passed\nrelease=%s\nsourceCommit=%s\nbinarySha256=%s\nwebTreeSha256=%s\nbackup=%s\n' "$release" "$source_commit" "$binary_sha" "$web_sha" "$backup"
    exit 0
  fi
  sleep 1
done
systemctl status "$service" --no-pager -l >&2 || true
exit 1
