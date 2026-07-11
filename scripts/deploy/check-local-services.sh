#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/bin"
  cat > "$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
case "$url" in
  http://127.0.0.1:6420/health)
    printf '%s\n' '{"ok":true}'
    ;;
  http://127.0.0.1:6420/status)
    printf '%s\n' '{"chainId":"6423","nativeCurrencySymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6420/node/identity)
    printf '%s\n' '{"role":"primary","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6426/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6427/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6428/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6429/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"providerConfigured":true,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$tmp/bin/curl"
  PATH="$tmp/bin:$PATH" "$0" primary abc123def456 ynx-chain-abc123def456 6423 full
  PATH="$tmp/bin:$PATH" "$0" singapore abc123def456 ynx-chain-abc123def456 6423 validator
  echo "check-local-services self-test passed"
  exit 0
fi

role="${1:?missing role}"
expected_commit="${2:?missing expected commit}"
expected_release="${3:?missing expected release}"
expected_chain_id="${4:?missing expected numeric chain id}"
mode="${5:-validator}"
attempts="${YNX_LOCAL_SERVICE_CHECK_ATTEMPTS:-30}"
sleep_seconds="${YNX_LOCAL_SERVICE_CHECK_SLEEP_SECONDS:-2}"

fetch_with_retry() {
  local name="$1" url="$2" body="" attempt
  for attempt in $(seq 1 "$attempts"); do
    if body="$(curl -fsS "$url" 2>/dev/null)"; then
      printf '%s' "$body"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  echo "local service check failed: $name did not respond at $url after $attempts attempts" >&2
  return 1
}

require_contains() {
  local name="$1" body="$2" needle="$3"
  if [[ "$body" != *"$needle"* ]]; then
    echo "local service check failed: $name missing $needle" >&2
    echo "$body" >&2
    return 1
  fi
}

check_chain_surface() {
  local status identity
  fetch_with_retry "chain health" "http://127.0.0.1:6420/health" >/dev/null
  status="$(fetch_with_retry "chain status" "http://127.0.0.1:6420/status")"
  require_contains "chain status" "$status" "$expected_chain_id"
  require_contains "chain status" "$status" "YNXT"
  require_contains "chain status build commit" "$status" "$expected_commit"
  require_contains "chain status release" "$status" "$expected_release"

  identity="$(fetch_with_retry "node identity" "http://127.0.0.1:6420/node/identity")"
  require_contains "node identity build commit" "$identity" "$expected_commit"
  require_contains "node identity release" "$identity" "$expected_release"
}

check_full_stack_surface() {
  local indexer explorer faucet ai_gateway
  indexer="$(fetch_with_retry "indexer health" "http://127.0.0.1:6426/health")"
  require_contains "indexer health" "$indexer" "$expected_chain_id"
  require_contains "indexer health" "$indexer" "YNXT"
  require_contains "indexer health build commit" "$indexer" "$expected_commit"
  require_contains "indexer health release" "$indexer" "$expected_release"

  explorer="$(fetch_with_retry "explorer health" "http://127.0.0.1:6427/health")"
  require_contains "explorer health" "$explorer" "$expected_chain_id"
  require_contains "explorer health" "$explorer" "YNXT"
  require_contains "explorer health build commit" "$explorer" "$expected_commit"
  require_contains "explorer health release" "$explorer" "$expected_release"

  faucet="$(fetch_with_retry "faucet health" "http://127.0.0.1:6428/health")"
  require_contains "faucet health" "$faucet" "$expected_chain_id"
  require_contains "faucet health" "$faucet" "YNXT"
  require_contains "faucet health build commit" "$faucet" "$expected_commit"
  require_contains "faucet health release" "$faucet" "$expected_release"

  ai_gateway="$(fetch_with_retry "AI Gateway health" "http://127.0.0.1:6429/health")"
  require_contains "AI Gateway health" "$ai_gateway" "$expected_chain_id"
  require_contains "AI Gateway health" "$ai_gateway" "YNXT"
  require_contains "AI Gateway health" "$ai_gateway" '"providerConfigured":true'
  require_contains "AI Gateway health build commit" "$ai_gateway" "$expected_commit"
  require_contains "AI Gateway health release" "$ai_gateway" "$expected_release"
}

case "$mode" in
  validator)
    check_chain_surface
    ;;
  full)
    check_chain_surface
    check_full_stack_surface
    ;;
  *)
    echo "unknown local service check mode for $role: $mode" >&2
    exit 1
    ;;
esac

echo "local service check passed: $role $mode $expected_release"
