#!/usr/bin/env bash
set -euo pipefail

candidate="${1:?missing candidate}"
sha="${2:?missing sha256}"
commit="${3:?missing commit}"
release="${4:?missing release}"
[[ "$(id -u)" == "0" ]] || { echo "installer requires root" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ && "$release" == "ynx-payd-${commit:0:12}" ]] || { echo "invalid release identity" >&2; exit 1; }
printf '%s  %s\n' "$sha" "$candidate" | sha256sum -c -
test -s /etc/ynx/ynx-payd.env
test -x /usr/local/bin/ynx-payd

backup="/var/backups/ynx-chain/pay-gateway-predeploy-$release"
install -d -m 0750 -o root -g ynx "$backup"
install -d -m 0700 -o ynx -g ynx "$backup/preflight"
cp -a /usr/local/bin/ynx-payd "$backup/ynx-payd"
cp -a /etc/ynx/ynx-payd.env "$backup/ynx-payd.env"
cp -a /etc/systemd/system/ynx-payd.service "$backup/ynx-payd.service"
install -m 0755 "$candidate" "$backup/candidate"

bash -c 'set -a; . /etc/ynx/ynx-payd.env; set +a; exec runuser -u ynx -- "$1" --http 127.0.0.1:17430 --audit-log "$2/preflight/audit.jsonl"' _ "$backup/candidate" "$backup" >"$backup/preflight.log" 2>&1 &
preflight=$!
cleanup() { kill "$preflight" 2>/dev/null || true; wait "$preflight" 2>/dev/null || true; }
trap cleanup EXIT
ready=0
for _ in $(seq 1 20); do
  health="$(curl -fsS --max-time 3 http://127.0.0.1:17430/health 2>/dev/null || true)"
  route="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:17430/pay/refunds/probe/complete || true)"
  if BUILD="$health" COMMIT="$commit" node -e 'const h=JSON.parse(process.env.BUILD);if(!h.ok||h.service!=="ynx-payd"||h.build?.commit!==process.env.COMMIT)process.exit(1)' 2>/dev/null && [[ "$route" == "405" ]]; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == "1" ]] || { tail -40 "$backup/preflight.log" >&2; exit 1; }
cleanup
trap - EXIT

rollback() { install -m 0755 "$backup/ynx-payd" /usr/local/bin/ynx-payd; systemctl restart ynx-payd; }
trap rollback ERR
install -m 0755 "$backup/candidate" /usr/local/bin/ynx-payd
systemctl restart ynx-payd
ready=0
for _ in $(seq 1 20); do
  health="$(curl -fsS --max-time 3 http://127.0.0.1:6430/health 2>/dev/null || true)"
  route="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:6430/pay/refunds/probe/complete || true)"
  if BUILD="$health" COMMIT="$commit" node -e 'const h=JSON.parse(process.env.BUILD);if(!h.ok||h.service!=="ynx-payd"||h.build?.commit!==process.env.COMMIT)process.exit(1)' 2>/dev/null && [[ "$route" == "405" ]]; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == "1" ]]
trap - ERR
printf 'payGatewayDeploy=passed\nrelease=%s\nsourceCommit=%s\nbackup=%s\n' "$release" "$commit" "$backup"
