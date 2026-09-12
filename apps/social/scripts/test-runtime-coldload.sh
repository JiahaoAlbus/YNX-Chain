#!/usr/bin/env bash
# Run on the approved Linux host as root, inside the agreed Core IO window.
# Never loads the candidate against production state or replaces its service.
set -euo pipefail
umask 077

stage=${1:?Usage: test-runtime-coldload.sh /var/tmp/ynx-social-STAGE EXPECTED_SHA256}
expected=${2:?Expected candidate SHA256 is required}
[[ $EUID == 0 ]] || { printf 'Root is required.\n' >&2; exit 1; }
[[ $stage =~ ^/var/tmp/ynx-social-[a-zA-Z0-9-]+$ ]] || exit 1
[[ $expected =~ ^[a-f0-9]{64}$ ]] || exit 1
[[ -d $stage && ! -L $stage && ! -L $stage/ynx-sociald ]] || exit 1
[[ $(realpath "$stage") == "$stage" ]] || exit 1
[[ $(sha256sum "$stage/ynx-sociald" | cut -d ' ' -f 1) == "$expected" ]] || exit 1
[[ -z $(ss -H -ltn 'sport = :16491') ]] || {
  printf 'Cold-load port 16491 is occupied.\n' >&2; exit 1;
}

trial=$(mktemp -d "$stage/coldload.XXXXXXXX")
unit="ynx-social-coldload-$(date +%s)-$$"
cleanup() { systemctl stop "$unit.service" >/dev/null 2>&1 || true; }
trap cleanup EXIT

state_hashes() {
  (cd "$1"; find . -type f -exec sha256sum {} + | LC_ALL=C sort)
}
state_hashes /var/lib/ynx-chain/social > "$trial/source-before.sha256"
cp -a /var/lib/ynx-chain/social "$trial/state"
state_hashes /var/lib/ynx-chain/social > "$trial/source-after.sha256"
state_hashes "$trial/state" > "$trial/copy.sha256"
cmp -s "$trial/source-before.sha256" "$trial/source-after.sha256" &&
  cmp -s "$trial/source-before.sha256" "$trial/copy.sha256" || {
    printf 'State changed during snapshot; no candidate started. Private trial: %s\n' "$trial" >&2
    exit 1
  }

# Preserve existing TOKEN_KEY and INTERNAL_API_KEY verbatim. This temporary
# machine secret is only for the isolated check, not the production Cloud pair.
cat /etc/ynx/ynx-sociald.env > "$trial/runtime.env"
printf '\nYNX_SOCIAL_CLOUD_AUTHORITY_TOKEN=' >> "$trial/runtime.env"
openssl rand -hex 32 >> "$trial/runtime.env"
chmod 600 "$trial/runtime.env"
chown ynx:ynx "$trial"
chown -R ynx:ynx "$trial/state"
chmod 700 "$trial" "$trial/state"

systemd-run --quiet --unit="$unit" --collect \
  --property=User=ynx --property=Group=ynx \
  --property=CPUQuota=100% --property=IOWeight=1 --property=Nice=19 \
  --property=RuntimeMaxSec=45s --property="WorkingDirectory=$trial" \
  --property="EnvironmentFile=$trial/runtime.env" \
  "$stage/ynx-sociald" -http 127.0.0.1:16491 -state-dir "$trial/state"

for ((attempt=0; attempt<20; attempt++)); do
  code=$(curl --silent --output /dev/null --max-time 1 --write-out '%{http_code}' \
    -X POST http://127.0.0.1:16491/internal/cloud-objects/authorize || true)
  if [[ $code == 401 ]]; then
    systemctl is-active --quiet "$unit.service"
    printf 'PASS candidate=%s state-copy=cold-loaded machine-route=401-without-credentials trial=%s\n' "$expected" "$trial"
    exit 0
  fi
  sleep 1
done
printf 'FAIL candidate did not expose the protected machine route; inspect private unit %s and trial %s.\n' "$unit" "$trial" >&2
exit 1
