#!/usr/bin/env bash
set -euo pipefail

image="${YNX_ORACLE_IMAGE:-ynx-oracle:testnet}"
work="$(mktemp -d)"
container=""
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

jq -n '{schema:"ynx.oracle.v1",providers:[{id:"local-dast-source",name:"Local DAST registry entry",endpoint:"https://local-dast-source.invalid.test/v1",apiVersion:"v1",assetMarketCoverage:["YNXT/YUSD_TEST"],license:"test fixture only",termsUrl:"https://local-dast-source.invalid.test/terms",permittedStorage:"test fixture only",authentication:"Ed25519 signed observation",rateLimit:"no runtime ingestion",timestampSemantics:"test event time",precision:"1e-6",timezone:"UTC",region:"local test",jurisdiction:"local test",cost:"not applicable",retention:"test lifetime",dataRights:"test fixture only",fallback:"fail closed",decommissionPlan:"delete ephemeral container",status:"legal_approval_required",reporterId:"reporter:local-dast-source",reporterPublicKeyHex:("ab"*32),weightPpm:1000000,updatedAt:"2026-07-22T19:00:00Z"}]}' > "$work/providers.json"

container="$(docker run -d --read-only --tmpfs /var/lib/ynx-oracle:uid=65532,gid=65532,mode=0700 -v "$work/providers.json:/etc/ynx-oracle/providers.json:ro" -e YNX_ORACLE_STATE_HMAC_KEY_HEX="$(printf 'cd%.0s' {1..32})" -p 127.0.0.1::6470 "$image")"
port=""
for _ in 1 2 3 4 5; do
  port="$(docker port "$container" 6470/tcp | sed 's/.*://' || true)"
  [[ -n "$port" ]] && break
  sleep 1
done
if [[ -z "$port" ]]; then
  docker logs "$container" >&2
  exit 1
fi
base="http://127.0.0.1:$port"
ready=false
for _ in 1 2 3 4 5; do
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$base/health" || true)" == "503" ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$container" >&2
  exit 1
fi

curl -sS -D "$work/health.headers" -o "$work/health.json" "$base/health"
jq -e '.status == "degraded" and .activeProviderCount == 0 and .minimumSources == 3' "$work/health.json" >/dev/null
for header in 'x-content-type-options: nosniff' 'x-frame-options: DENY' 'referrer-policy: no-referrer' 'cache-control: no-store' 'content-security-policy:' 'permissions-policy:' 'x-request-id:' 'traceparent:'; do
  grep -qi "^$header" "$work/health.headers"
done

if [[ "$(curl -sS -o "$work/version.json" -w '%{http_code}' "$base/version")" != "200" ]]; then exit 1; fi
jq -e '.schema == "ynx.oracle.v1" and .storeVersion == 3' "$work/version.json" >/dev/null
if [[ "$(curl -sS -o "$work/price.json" -w '%{http_code}' "$base/prices")" != "400" ]]; then exit 1; fi
if [[ "$(curl -sS -L --path-as-is -o "$work/path.json" -w '%{http_code}' "$base/../../etc/passwd")" != "404" ]]; then exit 1; fi
if [[ "$(curl -sS -X TRACE -o "$work/trace.json" -w '%{http_code}' "$base/health")" != "405" ]]; then exit 1; fi

head -c 70000 /dev/zero | curl -sS -X POST -H 'Content-Type: application/json' --data-binary @- -o "$work/oversize.json" -w '%{http_code}' "$base/internal/v1/observations" | grep -Eq '^(400|413)$'
curl -sS -D "$work/internal.headers" -X POST -H 'Origin: https://oracle.ynx.network' -H 'Content-Type: application/json' --data '{}' -o "$work/internal.json" "$base/internal/v1/observations"
if grep -qi '^access-control-allow-origin:' "$work/internal.headers"; then
  echo "internal ingestion exposed CORS" >&2
  exit 1
fi

if rg -n -i '(panic|stack trace|/users/|private key|hmac key|state\.json)' "$work"/*.json; then
  echo "unsafe error detail exposed" >&2
  exit 1
fi

docker inspect "$container" --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}' | grep -qx '65532:65532 true'
printf '%s\n' 'oracle DAST smoke passed: degraded fail-closed health, safe headers/errors, internal CORS denial, method/path/body rejection'
