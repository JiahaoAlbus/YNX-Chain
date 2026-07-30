#!/usr/bin/env bash
set -euo pipefail

base="${1:-${ORACLE_PUBLIC_URL:-}}"
expected_commit="${2:-${ORACLE_EXPECTED_COMMIT:-}}"
market="${3:-${ORACLE_TEST_MARKET:-}}"
source_mode="${4:-${ORACLE_SOURCE_MODE:-authoritative}}"
evidence_out="${ORACLE_EVIDENCE_OUT:-}"
resolve_ip="${ORACLE_RESOLVE_IP:-}"

[[ "$base" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || {
  echo "Oracle public URL must be an HTTPS origin" >&2
  exit 1
}
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Expected source commit must be a full Git SHA" >&2
  exit 1
}
[[ "$market" =~ ^[A-Z0-9]{2,16}/[A-Z0-9_]{2,16}$ ]] || {
  echo "Oracle smoke market is invalid" >&2
  exit 1
}
case "$source_mode" in
  authoritative | limited) ;;
  *) echo "Oracle source mode must be authoritative or limited" >&2; exit 1 ;;
esac
if [[ -n "$resolve_ip" && ! "$resolve_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "ORACLE_RESOLVE_IP must be an IPv4 address" >&2
  exit 1
fi
command -v curl >/dev/null
command -v jq >/dev/null
curl_tls=(--proto '=https' --tlsv1.2 --max-redirs 0 --connect-timeout 10 --max-time 20)
if [[ -n "$resolve_ip" ]]; then
  resolve_authority="${base#https://}"
  resolve_host="${resolve_authority%%:*}"
  resolve_port="${resolve_authority##*:}"
  if [[ "$resolve_port" == "$resolve_authority" ]]; then
    resolve_port=443
  fi
  curl_tls+=(--resolve "$resolve_host:$resolve_port:$resolve_ip")
fi
if [[ -n "${ORACLE_CA_CERT:-}" ]]; then
  [[ -f "$ORACLE_CA_CERT" && ! -L "$ORACLE_CA_CERT" ]] || {
    echo "ORACLE_CA_CERT must be a regular non-symlink file" >&2
    exit 1
  }
  curl_tls+=(--cacert "$ORACLE_CA_CERT")
fi

work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

fetch() {
  local path="$1" body="$2" headers="$3" expected_status="$4" status
  status="$(curl "${curl_tls[@]}" \
    -sS -D "$headers" -o "$body" -w '%{http_code}' "$base$path")"
  [[ "$status" == "$expected_status" ]] || {
    echo "Oracle $path returned HTTP $status" >&2
    return 1
  }
  [[ "$(wc -c < "$body" | tr -d ' ')" -le 1048576 ]] || {
    echo "Oracle $path response exceeds 1 MiB" >&2
    return 1
  }
  jq -e . "$body" >/dev/null
}

fetch "/version" "$work/version.json" "$work/version.headers" "200"
jq -e --arg commit "$expected_commit" '
  .productId == "ynx-oracle-market-data" and
  .schema == "ynx.oracle.v1" and
  .storeVersion == 3 and
  .commit == $commit
' "$work/version.json" >/dev/null

if [[ "$source_mode" == "authoritative" ]]; then
  fetch "/health" "$work/health.json" "$work/health.headers" "200"
  jq -e '
    .status == "ok" and
    .degraded == false and
    .activeProviderCount >= .minimumSources and
    .minimumSources >= 3 and
    .storageStatus == "ready" and
    .sourceLimitation == null and
    .lastSuccessfulAggregation != null
  ' "$work/health.json" >/dev/null
else
  fetch "/health" "$work/health.json" "$work/health.headers" "503"
  jq -e '
    .status == "degraded" and
    .degraded == true and
    .activeProviderCount == 0 and
    .minimumSources >= 3 and
    .storageStatus == "ready" and
    (.sourceLimitation | type == "string") and
    (.sourceLimitation | length) >= 20 and
    .lastSuccessfulAggregation == "0001-01-01T00:00:00Z"
  ' "$work/health.json" >/dev/null || {
    echo "Oracle limited-source health truth mismatch" >&2
    jq . "$work/health.json" >&2
    exit 1
  }
fi

for header in \
  'x-content-type-options: nosniff' \
  'x-frame-options: DENY' \
  'referrer-policy: no-referrer' \
  'cache-control: no-store' \
  'content-security-policy:' \
  'permissions-policy:' \
  'x-request-id:' \
  'traceparent:'
do
  grep -qi "^$header" "$work/health.headers"
done

fetch "/v1/providers" "$work/providers.json" "$work/providers.headers" "200"
if [[ "$source_mode" == "authoritative" ]]; then
  jq -e '
    [.items[] | select(.status == "active")] as $active |
    ($active | length) >= 3 and
    ([$active[].id] | unique | length) == ($active | length) and
    ([$active[].reporterId] | unique | length) == ($active | length) and
    ([$active[].reporterPublicKeyHex] | unique | length) == ($active | length)
  ' "$work/providers.json" >/dev/null
else
  jq -e '
    (.items | length) >= 1 and
    all(.items[];
      .status != "active" and
      .reporterId == "" and
      .reporterPublicKeyHex == "" and
      .weightPpm == 0
    )
  ' "$work/providers.json" >/dev/null
fi

price_status="$(curl "${curl_tls[@]}" \
  -sS -D "$work/price.headers" -o "$work/price.json" -w '%{http_code}' \
  --get --data-urlencode "market=$market" --data-urlencode "type=spot_price" "$base/v1/prices")"
if [[ "$source_mode" == "authoritative" ]]; then
  [[ "$price_status" == "200" ]] || {
    echo "Oracle authoritative price returned HTTP $price_status" >&2
    exit 1
  }
  jq -e --arg market "$market" '
    .schema == "ynx.oracle.v1" and
    .market == $market and
    .type == "spot_price" and
    .value > 0 and
    .scale > 0 and
    .source == "YNX Oracle signed provider aggregation" and
    .quality.status == "good" and
    .quality.stale == false and
    .quality.circuitBreaker == false and
    .quality.failure == null and
    .quality.sourceCount >= .quality.requiredSourceCount and
    .quality.requiredSourceCount >= 3 and
    .quality.confidencePpm > 0 and
    .quality.coveragePpm > 0 and
    (.observationIds | length) >= 3 and
    (.observationHashes | length) == (.observationIds | length) and
    (.lineageHash | test("^[0-9a-f]{64}$"))
  ' "$work/price.json" >/dev/null
else
  [[ "$price_status" == "503" ]] || {
    echo "Oracle limited-source price did not fail closed: HTTP $price_status" >&2
    exit 1
  }
  jq -e --arg market "$market" '
    .price.schema == "ynx.oracle.v1" and
    .price.market == $market and
    .price.type == "spot_price" and
    .price.value == 0 and
    .price.quality.status == "unavailable" and
    .price.quality.stale == true and
    .price.quality.circuitBreaker == true and
    (.price.quality.failure | type == "string") and
    (.price.quality.sourceLimitation | type == "string") and
    (.price.quality.sourceLimitation | length) >= 20 and
    (.error | type == "string") and
    (.errorId | type == "string")
  ' "$work/price.json" >/dev/null
fi

internal_status="$(curl "${curl_tls[@]}" \
  -sS -o "$work/internal.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  --data '{}' "$base/internal/v1/observations")"
[[ "$internal_status" == "404" ]] || {
  echo "Public ingress exposes internal observation ingestion: HTTP $internal_status" >&2
  exit 1
}

if [[ -n "$evidence_out" ]]; then
  evidence_parent="$(dirname "$evidence_out")"
  [[ -d "$evidence_parent" && ! -L "$evidence_parent" ]] || {
    echo "Evidence output parent must be an existing regular directory" >&2
    exit 1
  }
  generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n \
    --arg schema "ynx.oracle.public-testnet-evidence.v1" \
    --arg sourceCommit "$expected_commit" \
    --arg publicUrl "$base" \
    --arg market "$market" \
    --arg sourceMode "$source_mode" \
    --arg generatedAt "$generated_at" \
    --slurpfile version "$work/version.json" \
    --slurpfile health "$work/health.json" \
    --slurpfile providers "$work/providers.json" \
    --slurpfile price "$work/price.json" \
    '{
      schema: $schema,
      sourceCommit: $sourceCommit,
      publicUrl: $publicUrl,
      market: $market,
      sourceMode: $sourceMode,
      generatedAt: $generatedAt,
      version: $version[0],
      health: $health[0],
      providers: $providers[0],
      price: $price[0],
      internalIngestionPublicHttpStatus: 404
    }' > "$evidence_out"
  chmod 0600 "$evidence_out"
fi

printf 'Oracle public Testnet smoke passed: commit=%s market=%s source_mode=%s active_sources=%s\n' \
  "$expected_commit" "$market" "$source_mode" "$(jq '[.items[] | select(.status == "active")] | length' "$work/providers.json")"
